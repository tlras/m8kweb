// ==UserScript==
// @name         m8k-gl
// @version      1.0-alpha1
// @description  utility client for m4k (WebGL)
// @author       yagton
// @match        https://2s4.me/m4k/gl
// @grant        none
// ==/UserScript==

/* Copyright 2021 tlras

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at:
       http://www.apache.org/licenses/LICENSE-2.0
*/

((w) => {
    // Global variables.
    let flight_enabled = false;

    // Waits condition() to return true, then run good().
    let orig_setInterval = w.setInterval;
    function waitForCondition(condition, good, freq = 100) {
        let wait = orig_setInterval(() => {
            if (condition()) {
                w.clearInterval(wait);
                good();
            }
        }, freq);
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

    // Hook into setInterval to wrap around systemClockCycle().
    w.setInterval = (...args) => {
        w.console.log(args);
        if (args.length === 2 && args[0] === w.systemClockCycle) {
            w.console.info("[m8k-gl] injecting systemClockCycle hook");
            return orig_setInterval(() => {
                let preClockY = w.cameraPos[1];
                w.systemClockCycle();
                if (flight_enabled) updateFlightY(preClockY);
            }, ...(args.slice(1)));
        } else {
            return orig_setInterval(...args);
        }
    }

    // Hook into w.onkeydown to define custom keybinds.
    waitForCondition(() => (typeof w.onkeydown === "function"), () => {
        w.console.info("[m8k-gl] injecting keybind handler");
        let old_onkeydown = w.onkeydown

        w.onkeydown = (e) => {
            let code = e.keyCode ? e.keyCode : e.which;
            let speed;
            switch (code) {
                case 70: // f
                    flight_enabled = !flight_enabled;
                    break;
                case 192: // `
                    speed = w.parseFloat(w.prompt(
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
                    break;
                default:
                    old_onkeydown(e);
            }
        }
    });

    // Get access to the hidden blocks.
    waitForCondition(() => (typeof w.BlockMenuID !== "undefined"), () => {
        w.console.info("[m8k-gl] injecting menu items");

        w.BlockMenuLabel = w.BlockLabel.slice(1);
        w.BlockMenuID = [];
        for (let i = 1; i <= w.BlockMenuLabel.length; ++i) {
            w.BlockMenuID.push(i);
        }
    });
})(window);
