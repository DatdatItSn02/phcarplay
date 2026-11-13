import AVFoundation
import Speech

/// Âm thanh của ứng dụng.
enum AppAudio {
    /// Phát được cả khi gạt nút im lặng, và phát được ở nền (giai đoạn 15: Info.plist có UIBackgroundModes = audio).
    static func usePlayback() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
    }
}

enum VoiceEvent {
    case partial(String)   // chữ đang nói
    case result(String)    // câu đã nói xong
    case error(String)     // mã lỗi giống phía website: app-denied, not-available, no-speech, audio-capture, busy
}

/// Nghe một câu bằng nhận dạng giọng nói của Apple (cần Internet), theo cách của mẫu SpokenWord của Apple:
/// thu âm bằng AVAudioEngine, gửi dần cho SFSpeechRecognizer. Ngừng nói 1,5 giây (hoặc tối đa 15 giây) thì coi như xong.
final class VoiceRecognizer {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var handler: ((VoiceEvent) -> Void)?
    private var silenceTimer: Timer?
    private var limitTimer: Timer?
    private var tapInstalled = false
    private var running = false
    private var lastText = ""
    private var generation = 0   // tăng mỗi lần bắt đầu: bỏ qua kết quả đến muộn của lần trước

    func start(locale: String, handler: @escaping (VoiceEvent) -> Void) {
        cancel()
        generation += 1
        let mine = generation
        self.handler = handler
        running = true
        lastText = ""
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self = self, mine == self.generation, self.running else { return }
                guard status == .authorized else {
                    self.finish(.error("app-denied"))
                    return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                    DispatchQueue.main.async {
                        guard let self = self, mine == self.generation, self.running else { return }
                        guard granted else {
                            self.finish(.error("app-denied"))
                            return
                        }
                        self.begin(locale: locale, generation: mine)
                    }
                }
            }
        }
    }

    /// Hủy (website đóng hộp "Đang nghe..." hoặc ứng dụng ra nền). Không gọi lại handler.
    func cancel() {
        guard running else { return }
        running = false
        handler = nil
        teardown()
    }

    private func begin(locale: String, generation mine: Int) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
            finish(.error("not-available"))
            return
        }
        let audio = AVAudioSession.sharedInstance()
        do {
            try audio.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            finish(.error("busy"))
            return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            finish(.error("audio-capture"))
            return
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            req.append(buffer)
        }
        tapInstalled = true
        engine.prepare()
        do {
            try engine.start()
        } catch {
            finish(.error("audio-capture"))
            return
        }

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                self?.handle(result: result, error: error, generation: mine)
            }
        }
        armSilence(seconds: 5)   // chưa nói gì sau 5 giây thì thôi
        limitTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
            self?.complete()
        }
    }

    private func handle(result: SFSpeechRecognitionResult?, error: Error?, generation mine: Int) {
        guard mine == generation, running else { return }
        if let result = result {
            let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty && text != lastText {
                lastText = text
                handler?(.partial(text))
                armSilence(seconds: 1.5)
            }
            if result.isFinal {
                complete()
                return
            }
        }
        if error != nil {
            complete()
        }
    }

    private func armSilence(seconds: TimeInterval) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            self?.complete()
        }
    }

    private func complete() {
        guard running else { return }
        finish(lastText.isEmpty ? .error("no-speech") : .result(lastText))
    }

    private func finish(_ event: VoiceEvent) {
        guard running else { return }
        running = false
        let callback = handler
        handler = nil
        teardown()
        callback?(event)
    }

    private func teardown() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        limitTimer?.invalidate()
        limitTimer = nil
        if engine.isRunning {
            engine.stop()
        }
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        AppAudio.usePlayback()   // trả lại chế độ phát nhạc
    }
}
