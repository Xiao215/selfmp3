import ExpoModulesCore
import UIKit

/// A cover over the window while an iPad turns, from the moment UIKit says the
/// size will change until JavaScript has drawn the page at the new size.
///
/// UIKit lays the views out again at the new size inside the turn, and React
/// Native's views are the page JavaScript last drew: the computer's layout,
/// sidebar and player bar, squeezed into a portrait window for as long as
/// JavaScript takes to draw the phone's (r1 m43, R2-m17). Nothing in
/// JavaScript runs early enough to hide that. So the old frame, as it was,
/// fades out over the turn into the page's ground, and the ground stays until
/// JavaScript says it has drawn for this size (`drawnAt`), then fades away.
public class TurnCoverModule: Module {
  /// How long the cover waits for JavaScript before it goes regardless.
  private static let giveUpAfter: TimeInterval = 2.5
  /// How long it waits after JavaScript has drawn, for the views to be mounted.
  private static let settle: TimeInterval = 0.05
  private static let fadeOut: TimeInterval = 0.15

  private var watcher: TurnWatcher?
  private var cover: UIView?
  /// The window's size the cover is up for, once the turn has given it.
  private var coveredFor: CGSize?
  /// What JavaScript last said it had drawn for.
  private var drawn: CGSize?
  private var ground: UIColor = .black
  private var giveUp: DispatchWorkItem?

  public func definition() -> ModuleDefinition {
    Name("TurnCover")

    OnCreate {
      DispatchQueue.main.async { self.attach(tries: 10) }
    }

    OnDestroy {
      let watcher = self.watcher
      let cover = self.cover
      DispatchQueue.main.async {
        watcher?.willMove(toParent: nil)
        watcher?.view.removeFromSuperview()
        watcher?.removeFromParent()
        cover?.removeFromSuperview()
      }
    }

    /// The page's ground, which the cover wears once the old frame has faded.
    Function("setGround") { (color: UIColor) in
      DispatchQueue.main.async {
        self.ground = color
        self.cover?.backgroundColor = color
      }
    }

    /// JavaScript has drawn the page for a window this size.
    Function("drawnAt") { (width: Double, height: Double) in
      DispatchQueue.main.async {
        self.drawn = CGSize(width: width, height: height)
        self.uncoverIfDrawn()
      }
    }
  }

  /// A child of the root view controller, which hears the window's size
  /// change before the views are laid out at it.
  private func attach(tries: Int) {
    guard watcher == nil else { return }
    guard let root = Self.rootViewController() else {
      if tries > 0 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.attach(tries: tries - 1) }
      }
      return
    }
    let child = TurnWatcher()
    child.onTurn = { [weak self] coordinator in self?.turn(with: coordinator) }
    root.addChild(child)
    child.view.frame = .zero
    child.view.isHidden = true
    child.view.isUserInteractionEnabled = false
    root.view.addSubview(child.view)
    child.didMove(toParent: root)
    watcher = child
  }

  private func turn(with coordinator: UIViewControllerTransitionCoordinator) {
    guard let window = watcher?.view.window else { return }
    let before = window.bounds.size
    // The frame as it is now, kept at its own size in the middle of the window
    // as it turns, rather than stretched into the new shape.
    let frame = window.snapshotView(afterScreenUpdates: false)
    let veil = cover ?? UIView()
    veil.frame = window.bounds
    veil.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    veil.backgroundColor = ground
    veil.alpha = 1
    veil.layer.removeAllAnimations()
    veil.subviews.forEach { $0.removeFromSuperview() }
    if let frame {
      frame.frame = CGRect(origin: .zero, size: before)
      frame.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin, .flexibleTopMargin, .flexibleBottomMargin]
      veil.addSubview(frame)
    }
    window.addSubview(veil)
    cover = veil
    coveredFor = nil
    drawn = nil
    giveUp?.cancel()

    coordinator.animate(alongsideTransition: { _ in
      let after = window.bounds.size
      // Turned the other way up: the same shape, and nothing to draw again.
      if Self.same(after, before) {
        self.uncover(animated: false)
        return
      }
      self.coveredFor = after
      frame?.alpha = 0
    }, completion: { _ in
      frame?.removeFromSuperview()
      guard self.cover === veil else { return }
      let late = DispatchWorkItem { [weak self] in self?.uncover(animated: true) }
      self.giveUp = late
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.giveUpAfter, execute: late)
      self.uncoverIfDrawn()
    })
  }

  private func uncoverIfDrawn() {
    guard cover != nil, let coveredFor, let drawn, Self.same(coveredFor, drawn) else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.settle) { [weak self] in
      self?.uncover(animated: true)
    }
  }

  private func uncover(animated: Bool) {
    giveUp?.cancel()
    giveUp = nil
    guard let veil = cover else { return }
    cover = nil
    coveredFor = nil
    guard animated else {
      veil.removeFromSuperview()
      return
    }
    UIView.animate(withDuration: Self.fadeOut, delay: 0, options: [.curveEaseOut, .beginFromCurrentState], animations: {
      veil.alpha = 0
    }, completion: { _ in
      veil.removeFromSuperview()
    })
  }

  private static func same(_ a: CGSize, _ b: CGSize) -> Bool {
    abs(a.width - b.width) < 1 && abs(a.height - b.height) < 1
  }

  private static func rootViewController() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    return (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
  }
}

/// Hears the window's size about to change: UIKit tells a view controller's
/// children what it tells the view controller.
private final class TurnWatcher: UIViewController {
  var onTurn: ((UIViewControllerTransitionCoordinator) -> Void)?

  override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
    super.viewWillTransition(to: size, with: coordinator)
    onTurn?(coordinator)
  }
}
