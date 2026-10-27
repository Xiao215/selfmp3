import ExpoModulesCore
import UIKit

/// Back to the Home Screen, as the Home gesture goes.
///
/// A newer build opened from inside the app (`itms-services://`) downloads,
/// then waits: iOS replaces an app only once it has left the screen, and the
/// app on the screen is the one asking. Pressing Install did nothing anyone
/// could see (2026-10-27) — the download sat behind the open app. Stepping
/// back lets it go in, with its progress on the app's icon.
///
/// `suspend` is UIApplication's own, not public API: fine for a build shared
/// ad hoc, which no App Review reads.
public class HomeScreenModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HomeScreen")

    Function("leave") {
      DispatchQueue.main.async {
        UIApplication.shared.perform(NSSelectorFromString("suspend"))
      }
    }
  }
}
