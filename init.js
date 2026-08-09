/**
 * JoyTuneRx - OpenWebRX+ Gamepad Control Plugin Initialization Hook
 * Path: htdocs/plugins/receiver/joytune/init.js
 */

(async () => {
    await Plugins.load('joytuneRx'); 
    console.log("JoyTuneRx - SDR Gamepad Control Bootloader: Success");
})();
