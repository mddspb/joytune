/**
 * JoyTune - OpenWebRX+ Gamepad Control Plugin Initialization Hook
 * Path: htdocs/plugins/receiver/joytune/init.js
 */

(async () => {
    await Plugins.load('joytune'); 
    console.log("JoyTune - SDR Gamepad Control Bootloader: Success");
})();
