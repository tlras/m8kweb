// ==UserScript==
// @name         m8k-gl
// @version      1.0-alpha5.4
// @namespace    https://github.com/tlras
// @description  utility client for m4k (WebGL)
// @license      Apache-2.0
// @author       yagton
// @match        https://2s4.me/m4k/gl
// @grant        none
// @updateURL    https://raw.githubusercontent.com/tlras/m8k-client/master/m8k.user.js
// @downloadURL  https://raw.githubusercontent.com/tlras/m8k-client/master/m8k.user.js
// @supportURL   https://github.com/tlras/m8k-client/issues
// @require      binds.js
// ==/UserScript==

/* Copyright 2022 tlras
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use
 * this file except in compliance with the License. You may obtain a copy of the
 * License at http://www.apache.org/licenses/LICENSE-2.0 */

((w) => {
    // Global variables.
    let flight_enabled = false;
    let MD_middle = false;
    let internalFOV = (80 * w.Math.PI) / 180;
    const FOVDelta = (1 * w.Math.PI) / 180;
    let fast_use = false;
    let disableClicks = 0;
    const clickDelay = 2500 /* milliseconds */;

    // Waits condition() to return true, then run good().
    let old_setInterval = w.setInterval;
    function waitForCondition(condition, good, pollFreq = 100) {
        let wait = old_setInterval(() => {
            if (condition()) {
                w.clearInterval(wait);
                good();
            }
        }, pollFreq);
    }

    // y-axis movement handler when flight is enabled
    function updateFlightY(posY) {
        if (w.Jump) {
            w.cameraPos[1] = posY - w.walkSpeed;
        } else if (w.Shift) {
            w.cameraPos[1] = posY + w.walkSpeed;
        } else {
            w.cameraPos[1] = posY;
        }
    }

    /* Our wrapper around systemClockCycle().
     * (i.e. stuff you want to run each tick) */
    function clockCycle() {
        if (MD_middle) {
            let block = w.getBlock(w.selectX, w.selectY, w.selectZ, 0);
            if (block !== 0) w.selectedBlock = block;
            w.updatePreviewBlock();
        }

        let old_getBlock;
        if (flight_enabled) {
            old_getBlock = w.getBlock;
            let call_counter = 0;
            w.getBlock = (...args) => {
                ++call_counter;
                if (call_counter > w.MD_right) {
                    return 0;
                } else {
                    return old_getBlock(...args);
                }
            };
        }

        let preClockY = w.cameraPos[1];
        if (fast_use) w.CantClick = disableClicks;

        w.systemClockCycle();

        if (fast_use && !disableClicks) {
            disableClicks = 1;
            old_setInterval(() => { disableClicks = 0 }, clickDelay);
        }

        if (flight_enabled) {
            updateFlightY(preClockY);
            w.getBlock = old_getBlock;
        }
    }

    // Hook into setInterval to wrap around systemClockCycle().
    w.setInterval = (...args) => {
        if (args.length === 2 && args[0] === w.systemClockCycle) {
            w.console.info("[m8k-gl] injecting systemClockCycle hook");
            return old_setInterval(clockCycle, ...(args.slice(1)));
        } else {
            return old_setInterval(...args);
        }
    }

    // Hook into w.onkeydown to define custom keybinds.
    waitForCondition(() => (typeof w.onkeyup === "function"), () => {
        w.console.info("[m8k-gl] injecting keybind handler");

        let old_onkeydown = w.onkeydown;
        let old_onkeyup = w.onkeyup;

        w.onkeydown = (e) => {
            let [exists, _] = KeybindManager.keydown_handler(e);
            if (!exists) old_onkeydown(e);
        };

        w.onkeyup = (e) => {
            let [exists, _] = KeybindManager.keyup_handler(e);
            if (!exists) old_onkeyup(e);
        };

        // === Movement-related binds.
        KeybindManager.adddown("Backquote", () => {
            let speed = w.parseFloat(w.prompt(
                "Set movement speed (default is 0.1)",
                w.walkSpeed
            ));

            if (!w.Number.isNaN(speed)) {
                w.defaultWalkSpeed = speed;
                w.defaultRunSpeed = speed + 0.1;
                w.walkSpeed = w.defaultWalkSpeed;
            } else {
                w.console.warn("[m8k] ignoring non-numeric input");
            }
        });

        KeybindManager.adddown("KeyF", () => {
            flight_enabled = !flight_enabled;
        });

        // === FOV binds.
        KeybindManager.adddown("Equal", () => {
            let FOV = w.parseFloat(w.prompt(
                "Set FOV (default is 80)",
                Math.trunc((internalFOV * 180) / w.Math.PI)
            ));

            if (!w.Number.isNaN(FOV)) {
                let internalFOV = (FOV * w.Math.PI) / 180;
            } else {
                w.console.warn("[m8k] ignoring non-numeric input");
            }
        });

        KeybindManager.adddown("BracketLeft", () => {
            let newFOV = internalFOV;
            newFOV += FOVDelta;
            if (newFOV <= w.Math.PI) internalFOV = newFOV;
        });

        KeybindManager.adddown("BracketRight", () => {
            let newFOV = internalFOV;
            newFOV -= FOVDelta;
            if (newFOV > 0) internalFOV = newFOV;
        });

        // === Miscellaneous binds.
        KeybindManager.adddown("KeyR", w.setSpawnPos);

        KeybindManager.adddown("KeyE", () => { fast_use = true; });
        KeybindManager.addup("KeyE", () => { fast_use = false; });
    });

    // Hook into perspective to set our own FOV.
    let old_perspective = w.perspective;
    w.perspective = (...args) => {
        if (args.length >= 2 && args[1] === ((80 * w.Math.PI) / 180)) {
            args[1] = internalFOV;
        }

        old_perspective(...args);
    }

    // Get access to the hidden blocks.
    waitForCondition(() => (typeof w.BlockMenuID !== "undefined"), () => {
        w.console.info("[m8k-gl] injecting menu items");

        w.BlockMenuLabel = w.BlockLabel.slice(1);
        w.BlockMenuID = [];
        for (let i = 1; i <= w.BlockMenuLabel.length; ++i) {
            w.BlockMenuID.push(i);
        }
    });

    // Make a wrapper around the click handler for middle click functionality.
    waitForCondition(() => typeof w.output.onmouseup === "function", () => {
        w.console.info("[m8k-gl] injecting click handler");

        let old_onmousedown = w.output.onmousedown;
        w.output.onmousedown = (e) => {
            if (e.button === 1) {
                MD_middle = true;
            } else {
                return old_onmousedown(e);
            }
        }

        let old_onmouseup = w.output.onmouseup;
        w.output.onmouseup = () => {
            MD_middle = false;
            return old_onmouseup();
        }
    });

    // Water transparency temporarly disabled due to culling issues.
})(window);
