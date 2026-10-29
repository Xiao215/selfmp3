# The app's own module for stepping back to the Home Screen, which an iPhone
# build being replaced needs (src/ports/iosUpdate.ts). Expo's autolinking finds
# it in apps/app/modules; it is iOS only, so Android and the web never see it.
Pod::Spec.new do |s|
  s.name           = 'HomeScreen'
  s.version        = '1.0.0'
  s.summary        = 'Steps self.mp3 back to the Home Screen'
  s.description    = 'Suspends the app, as the Home gesture does, so iOS can install a newer build over it.'
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
