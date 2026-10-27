# The app's own module that covers the window while an iPad turns, until the
# page has been drawn for the new shape (src/ports/turnCover.ts). Expo's
# autolinking finds it in apps/app/modules; it is iOS only.
Pod::Spec.new do |s|
  s.name           = 'TurnCover'
  s.version        = '1.0.0'
  s.summary        = 'A cover over the window while an iPad turns, for self.mp3'
  s.description    = 'Covers the window from the start of a size change until JavaScript has drawn the page at the new size.'
  s.license        = 'UNLICENSED'
  s.author         = 'self.mp3'
  s.homepage       = 'https://github.com/Xiao215/selfmp3'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.frameworks = 'UIKit'
end
