import UIKit

/// Màn hình báo lỗi phủ lên trang web: "Không kết nối được" (có nút Thử lại) và "Chưa cài địa chỉ website".
final class StatusView: UIView {
    private let titleLabel = UILabel()
    private let messageLabel = UILabel()
    private let detailLabel = UILabel()
    private let button = UIButton(type: .system)
    private var onAction: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = AppColors.background
        isHidden = true

        titleLabel.font = .boldSystemFont(ofSize: 24)
        titleLabel.textColor = .white
        messageLabel.font = .systemFont(ofSize: 18)
        messageLabel.textColor = UIColor(white: 0.82, alpha: 1)
        detailLabel.font = .systemFont(ofSize: 13)
        detailLabel.textColor = UIColor(white: 0.55, alpha: 1)
        for label in [titleLabel, messageLabel, detailLabel] {
            label.textAlignment = .center
            label.numberOfLines = 0
        }

        var config = UIButton.Configuration.filled()
        config.baseBackgroundColor = AppColors.brand
        config.baseForegroundColor = .white
        config.cornerStyle = .large
        config.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 32, bottom: 14, trailing: 32)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = UIFont.boldSystemFont(ofSize: 20)
            return outgoing
        }
        button.configuration = config
        button.addTarget(self, action: #selector(actionTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [titleLabel, messageLabel, button, detailLabel])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: safeAreaLayoutGuide.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 560),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    /// actionTitle = nil: không có nút.
    func show(title: String, message: String, detail: String?, actionTitle: String?, action: (() -> Void)?) {
        titleLabel.text = title
        messageLabel.text = message
        detailLabel.text = detail
        detailLabel.isHidden = (detail ?? "").isEmpty
        button.configuration?.title = actionTitle
        button.isHidden = actionTitle == nil
        onAction = action
        isHidden = false
        superview?.bringSubviewToFront(self)
    }

    func hide() {
        isHidden = true
    }

    var isShowing: Bool {
        !isHidden
    }

    @objc private func actionTapped() {
        onAction?()
    }
}
