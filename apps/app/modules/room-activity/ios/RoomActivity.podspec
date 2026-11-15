# The room on the Lock Screen and in the Dynamic Island: the app's side of the
# Live Activity (src/ports/roomActivity.ts). The widget target draws it
# (targets/widget/RoomActivity.swift). Expo's autolinking finds it in
# apps/app/modules; it is iOS only.
Pod::Spec.new do |s|
  s.name           = 'RoomActivity'
  s.version        = '1.0.0'
  s.summary        = 'Shows a self.mp3 room as a Live Activity'
  s.description    = 'Starts, updates and ends the Live Activity for the room this iPhone is in.'
  s.license        = 'UNLICENSED'
  s.author         = 'self.mp3'
  s.homepage       = 'https://github.com/Xiao215/selfmp3'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.frameworks = 'UIKit', 'ActivityKit'
end
