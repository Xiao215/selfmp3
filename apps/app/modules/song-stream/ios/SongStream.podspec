# The app's own module that plays a bucket song from one download of it
# (src/ports/songStream.ts). Expo's autolinking finds it in apps/app/modules;
# it is iOS only for now, so Android streams range by range as before.
Pod::Spec.new do |s|
  s.name           = 'SongStream'
  s.version        = '1.0.0'
  s.summary        = 'One download per bucket song, played as it arrives'
  s.description    = 'A loopback HTTP server that answers the player from one whole download of each song.'
  s.license        = 'UNLICENSED'
  s.author         = 'self.mp3'
  s.homepage       = 'https://github.com/Xiao215/selfmp3'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
end
