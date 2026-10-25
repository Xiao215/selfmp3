/**
 * Apply apps/app/patches to the player's iOS code on every `pod install`.
 *
 * react-native-track-player 5.0.0-alpha0 and the SwiftAudioEx 1.1.0 pod it
 * pulls in could deadlock: a skip held SwiftAudioEx's queue lock and waited on
 * AVPlayerWrapper's state queue, while that queue's barrier was announcing a
 * state change that waited on the lock. The skip ran on the TurboModule
 * manager's one shared queue, so NativeAnimated, which has no queue of its own,
 * waited behind it for good: every native-driven animation in the app stopped
 * (sheets that never open, toasts that never leave, blank pages). A run of
 * unplayable songs, skipping several times a second, hit it most launches.
 *
 * - SwiftAudioEx+1.1.0.patch announces state changes after the barrier, and
 *   unlocks the queue lock even when the locked work throws.
 * - react-native-track-player+5.0.0-alpha0.patch gives the player its own
 *   method queue, so anything that still blocks inside it stops only the
 *   player.
 *
 * SwiftAudioEx is a CocoaPod, out of reach of npm, which is why the patches
 * are applied here rather than at `npm install`. A patch that is already in
 * place is left alone; one that no longer applies (an upgrade) fails the
 * install, so drop it then if the new version has the fix.
 */
const { withPodfile } = require('expo/config-plugins')

const MARK = '# withPlayerPatches'

const APPLY = `
    ${MARK}: apps/app/plugins/withPlayerPatches.js
    {
      'SwiftAudioEx' => 'SwiftAudioEx+1.1.0.patch',
      'react-native-track-player' => 'react-native-track-player+5.0.0-alpha0.patch',
    }.each do |pod, name|
      dir = installer.sandbox.pod_dir(pod).to_s
      patch = File.expand_path("../patches/#{name}", __dir__)
      next if system('patch', '-p1', '-R', '-s', '-f', '--dry-run', '-d', dir, '-i', patch, out: File::NULL)
      system('patch', '-p1', '-s', '-f', '-N', '-d', dir, '-i', patch) or raise "#{name} does not apply to #{dir}"
    end
`

module.exports = function withPlayerPatches(config) {
  return withPodfile(config, mod => {
    const podfile = mod.modResults.contents
    if (podfile.includes(MARK)) return mod
    const anchor = 'post_install do |installer|'
    if (!podfile.includes(anchor))
      throw new Error(`withPlayerPatches: no "${anchor}" in the Podfile`)
    mod.modResults.contents = podfile.replace(anchor, anchor + APPLY)
    return mod
  })
}
