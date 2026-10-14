# The app's own module for a hardware keyboard's shortcuts on an iPad or an
# iPhone (docs/MOBILE.md, "A hardware keyboard"). Expo's autolinking finds it
# in apps/app/modules; it is iOS only, so Android and the web never see it.
Pod::Spec.new do |s|
  s.name           = 'KeyCommands'
  s.version        = '1.0.0'
  s.summary        = 'Hardware keyboard shortcuts for self.mp3'
  s.description    = 'Adds UIKeyCommands to the root view controller and sends each press to JavaScript.'
  s.license        = 'UNLICENSED'
  s.author         = 'self.mp3'
  s.homepage       = 'https://github.com/Xiao215/selfmp3'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.frameworks = 'UIKit', 'GameController'
end
