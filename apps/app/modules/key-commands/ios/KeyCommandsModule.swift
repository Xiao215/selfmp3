import ExpoModulesCore
import GameController
import UIKit

/// One shortcut as JavaScript describes it (`src/ports/keyCommands.ts`).
struct KeyCommandSpec: Record {
  /// `a`, `,`, ` `, or one of the named keys below: `ArrowLeft`, `Escape`, `Enter`.
  @Field var input: String = ""
  /// Any of `command`, `alternate`, `shift`, `control`.
  @Field var modifiers: [String] = []
  /// What holding ⌘ shows beside the key. None keeps the key out of that list.
  @Field var title: String?
  /// Kept while a text field is being typed in. An unmodified key (Space, an
  /// arrow) and the ⌘-arrows would otherwise beat the field: no space could be
  /// typed and ⌘← would not move the caret.
  @Field var whileTyping: Bool = false
}

/// A hardware keyboard's shortcuts: `UIKeyCommand`s on the root view
/// controller, each press sent to JavaScript as `{ input, modifiers }`.
///
/// React Native delivers no key presses on iOS, and a key command is the way
/// UIKit hands them out. Commands on the root view controller are in every
/// responder chain the app has — a presented sheet's chain runs through the
/// controller that presented it — and their titles are what iPadOS lists when
/// ⌘ is held.
public class KeyCommandsModule: Module {
  /// The module that answers a press: the selector lives on every view
  /// controller (below), which has no other way to find it.
  fileprivate static weak var current: KeyCommandsModule?

  private var specs: [KeyCommandSpec] = []
  private var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?
  /// The text field or text view being typed in, while there is one.
  private weak var editing: UIResponder?
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("KeyCommands")

    Events("onKeyCommand", "onKeyboardChange")

    OnCreate {
      KeyCommandsModule.current = self
      DispatchQueue.main.async { self.observe() }
    }

    OnDestroy {
      let observers = self.observers
      let installed = self.installed
      let host = self.host
      DispatchQueue.main.async {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        installed.forEach { host?.removeKeyCommand($0) }
      }
    }

    /// Whether a hardware keyboard is attached now: a Magic Keyboard, a
    /// Bluetooth one, the Mac's own when the simulator passes it through.
    Function("keyboardAttached") { () -> Bool in
      GCKeyboard.coalesced != nil
    }

    /// The whole set of shortcuts, replacing the last one.
    Function("setCommands") { (commands: [KeyCommandSpec]) in
      DispatchQueue.main.async {
        self.specs = commands
        self.install()
      }
    }
  }

  private func observe() {
    let center = NotificationCenter.default
    let began: (Notification) -> Void = { [weak self] note in
      self?.editing = note.object as? UIResponder
      self?.install()
    }
    let ended: (Notification) -> Void = { [weak self] note in
      guard let self, (note.object as? UIResponder) === self.editing else { return }
      self.editing = nil
      self.install()
    }
    let keyboard: (Notification) -> Void = { [weak self] _ in
      self?.sendEvent("onKeyboardChange", ["attached": GCKeyboard.coalesced != nil])
    }
    observers = [
      center.addObserver(forName: UITextField.textDidBeginEditingNotification, object: nil, queue: .main, using: began),
      center.addObserver(forName: UITextView.textDidBeginEditingNotification, object: nil, queue: .main, using: began),
      center.addObserver(forName: UITextField.textDidEndEditingNotification, object: nil, queue: .main, using: ended),
      center.addObserver(forName: UITextView.textDidEndEditingNotification, object: nil, queue: .main, using: ended),
      center.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main, using: keyboard),
      center.addObserver(forName: .GCKeyboardDidDisconnect, object: nil, queue: .main, using: keyboard),
    ]
  }

  /// Takes the old commands off and puts the ones that apply now on: all of
  /// them, or while someone is typing only those that may beat a text field.
  private func install() {
    installed.forEach { host?.removeKeyCommand($0) }
    installed = []
    guard let root = Self.rootViewController() else { return }
    host = root
    let typing = editing != nil
    for spec in specs where !typing || spec.whileTyping {
      let command = UIKeyCommand(
        title: spec.title ?? "",
        action: #selector(UIViewController.selfmp3KeyCommand(_:)),
        input: Self.uikitInput(spec.input),
        modifierFlags: Self.flags(spec.modifiers),
        propertyList: ["input": spec.input, "modifiers": spec.modifiers]
      )
      if let title = spec.title { command.discoverabilityTitle = title }
      // An arrow is the scroll view's and the focus system's before it is a
      // key command's, unless the command asks.
      if spec.input.hasPrefix("Arrow") { command.wantsPriorityOverSystemBehavior = true }
      root.addKeyCommand(command)
      installed.append(command)
      // An iPad's Magic Keyboard has no Escape key; ⌘. is Escape there, as on a Mac.
      if spec.input == "Escape" && spec.modifiers.isEmpty {
        let period = UIKeyCommand(
          action: #selector(UIViewController.selfmp3KeyCommand(_:)),
          input: ".",
          modifierFlags: .command,
          propertyList: ["input": spec.input, "modifiers": spec.modifiers]
        )
        root.addKeyCommand(period)
        installed.append(period)
      }
    }
    #if DEBUG
    NSLog("[KeyCommands] %d commands for %d keys%@", installed.count, specs.count, typing ? " (typing)" : "")
    #endif
  }

  fileprivate func fire(_ command: UIKeyCommand) {
    guard let props = command.propertyList as? [String: Any] else { return }
    #if DEBUG
    NSLog("[KeyCommands] pressed %@ %@", (props["modifiers"] as? [String] ?? []).joined(separator: "+"), props["input"] as? String ?? "")
    #endif
    // Escape while an input method is composing is the input method's: it drops
    // the composition. Should the command have had the key first, it does
    // nothing here rather than close what the field is in.
    if (props["input"] as? String) == "Escape", let field = editing as? UITextInput, field.markedTextRange != nil {
      return
    }
    sendEvent("onKeyCommand", [
      "input": props["input"] ?? "",
      "modifiers": props["modifiers"] ?? [],
      "typing": editing != nil,
    ])
  }

  private static func rootViewController() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    return (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
  }

  private static func uikitInput(_ input: String) -> String {
    switch input {
    case "ArrowLeft": return UIKeyCommand.inputLeftArrow
    case "ArrowRight": return UIKeyCommand.inputRightArrow
    case "ArrowUp": return UIKeyCommand.inputUpArrow
    case "ArrowDown": return UIKeyCommand.inputDownArrow
    case "Escape": return UIKeyCommand.inputEscape
    case "Enter": return "\r"
    case "Tab": return "\t"
    default: return input
    }
  }

  private static func flags(_ modifiers: [String]) -> UIKeyModifierFlags {
    var flags: UIKeyModifierFlags = []
    for modifier in modifiers {
      switch modifier {
      case "command": flags.insert(.command)
      case "alternate": flags.insert(.alternate)
      case "shift": flags.insert(.shift)
      case "control": flags.insert(.control)
      default: break
      }
    }
    return flags
  }
}

extension UIViewController {
  /// Every key command's action. UIKit sends it up the responder chain from
  /// whatever has focus, and the first view controller on the way answers it.
  @objc func selfmp3KeyCommand(_ command: UIKeyCommand) {
    KeyCommandsModule.current?.fire(command)
  }
}
