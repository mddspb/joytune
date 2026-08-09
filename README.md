# JoyTuneRx - OpenWebRX+ Gamepad Control Plugin (v1.7)

An open-source JS extension for **OpenWebRX+** that implements native W3C Gamepad API integration. It converts a standard 10-inch Android tablet or smartphone into an ergonomic, tactical WebSDR console using standard Bluetooth controllers (e.g., **iPega PG-9023** or single-sided "half-gamepads").

Developed specifically for Short Wave Listeners (SWL) and radio amateurs performing mobile field activities like **SOTA** (Summits on the Air) and **POTA** (Parks on the Air).

---

## 🚀 Key Functional Architecture

1. **One-Handed Free View:** Full radio spectrum searching (VFO) and waterfall scale mapping (Zoom) are condensed into a single analog thumbstick, leaving your other hand completely free to log calls or adjust antennas.
2. **Dynamic UI Shifting (Full-Screen Mode):** Pressing the **START** button entirely collapses the OpenWebRX+ right-hand panel, extending the spectrum waterfall across 100% of your screen estate.
3. **Green Neon HUD Overlay:** Changes to bands or modulations flash transparent, scale-adaptive Heads-Up Displays right over the center screen area, bypassing tiny web text elements entirely.
4. **Asymmetrical Hardware Fallback:** Automatically identifies full twin-stick gamepads or compact single-side phone grips. If a half-gamepad is used, it merges core navigation features cleanly onto the single stick.

---

## 🎮 Complete Control Map (v1.7)

### Standard Input Matrix (No Modifiers Held)

| Controller Input | Action Type | Targeted OWRX+ Module | Operational Context |
| :--- | :--- | :--- | :--- |
| **Right Stick (X)** | Analog Axis | **VFO Main Dial** | Smooth frequency tuning. Features square-exponential speed acceleration. **Disabled if VFO Lock is ON**. |
| **Right Stick (Y)** | Analog Axis | **Waterfall Zoom** | Up = Scales view closer (isolate peaks); Down = Pulls view back (wide overview). |
| **Right Stick Click (R3)**| Click | **VFO Dial Lock** | **[NEW v1.7]** Safety toggle. Instantly locks/unlocks frequency dial to prevent accidental tuning. |
| **Left Stick (Y)*** | Analog Axis | **Filter Bandwidth** | Up/Down stretches/shrinks the DSP High Cutoff to isolate narrow signals. |
| **Left Stick (X)*** | Analog Axis | **RF Sensitivity** | Left/Right overrides Automatic Gain Control to drop external noise floor. |
| **Left Stick Click (L3)***| Click | **Notch Filter** | **[NEW v1.7]** Toggles the digital Notch Filter to cut narrow harmonic tones/whistles. |
| **D-Pad Up / Down** | Click Button | **Band Stacking** | Quickly steps across HAM allocations (160m down to 70cm). Fires HUD display. |
| **D-Pad Left / Right** | Click Button | **Mode Demodulator** | Swaps through main modes (USB, LSB, CW, AM, NFM). Fires HUD display. |
| **Button A** | Click Button | **Squelch Toggle** | Instantly silences or opens static noise floor gates. |
| **Button B** | Click Button | **Filter Reset** | Drops custom cutoffs back to standard values (e.g., 2.4kHz for SSB). |
| **Button X** | Click Button | **Center Viewport** | Snaps the waterfall grid symmetrically around your VFO line. |
| **Button Y** | Click Button | **Memory Bookmark** | Adds your current capture to server-side bookmarks instantly. |
| **START** | Click Button | **Plugin UI Toggle** | Toggles script loop, and collapses/restores side panels. |
| **SELECT** | Click Button | **AGC Hardware Shifter**| Toggles receiver Automatic Gain Control loop state. |

*\*Note: Left-hand stick inputs degrade gracefully if an ultra-compact single-side grip is connected.*

---

## 🔀 Biomechanical Cross-Handed Shift Modifiers

To reduce layout complexity, the script leverages an opposing cross-hand design. Squeezing a bumper with one index finger lets you perform complex multi-threshold matrix corrections on the opposite thumbstick safely and easily:

### 1. Left Bumper (L1) + Right Stick ➔ Audio Squelch (SQ)
* **↔ Right Stick Left/Right:** Seamlessly moves **both SQ sliders together** in parallel across the noise line (Adjusts global signal gate level).
* **↕ Right Stick Up/Down:** Edits the spacing between open/close marks (Fine-tunes the **Hysteresis** safety threshold to eliminate gate popping).

### 2. Right Bumper (R1) + Left Stick ➔ Digital Noise Reduction (NR)
* **↔ Left Stick Left/Right:** Modifies spectral subtraction parameters (Deepens digital voice extraction from underlying hiss).
* **↕ Left Stick Up/Down:** Tunes math smoothing filters to clean up processing noise and artifacts.

---

## 🛹 Quick Real-Time Pedal Triggers (Triggers L2 / R2)

Triggers run on temporary state-memory architectures. They behave exactly like temporary override pedals on stationary professional transceivers:

* **Left Trigger (L2 Pedal) [Hold]:** Temporarily forces both **SQ thresholds downward**, instantly cracking open the gate to let you monitor weak signals in raw format. Releasing L2 restores your original SQ geometry perfectly.
* **Right Trigger (R2 Pedal) [Hold]:** Temporarily **drops the digital NR calculation threshold**, returning pure analog raw audio transparency to verify weak signals. Releasing R2 re-engages your DSP parameters immediately.

---

## 🛠 File Installation & Server Deployment

### 1. File Deployment
Unpack the `.zip` archive. Place the unzipped folder structures inside your local installation storage layout:
```bash
htdocs/plugins/receiver/joytunerx/joytunerx.js
htdocs/plugins/receiver/joytunerx/init.js
```

### 2. Manual Activation Check
Ensure your global plugin entry file contains a clear execution hook:
```javascript
// Path: htdocs/plugins/receiver/init.js
(async () => {
    await Plugins.load('gamepad_control'); 
})();
```

### 3. Android Bluetooth Setup
Browsers on Android require devices to pass standard OS layout configurations. Ensure you boot your hardware into its native **Android HID / Gamepad profile** before launching Chrome, Kiwi, or Opera. 
*(For iPega PG-9023, hold **`X + HOME`** simultaneously to wake up in HID configuration mode).*

---
**License:** Distributed under the open MIT license framework. Feel free to copy, modify, or submit pull requests. Best luck on field tests! 73!

