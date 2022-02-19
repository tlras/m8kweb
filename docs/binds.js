"use strict";

/* Copyright 2022, tlras
 *
 * Copying and distribution of this file, with or without modification, are
 * permitted in any medium without royalty, provided the copyright notice and
 * this notice are preserved. This file is offered as-is, without any warranty. */

var KeybindManager = (() => {
    keydown_binds = [];
    keyup_binds = [];

    return {
        adddown: (key, func) => {
            if (typeof this.keydown_binds[key] !== "undefined") {
                throw `${key} is already bound!`;
            } else if (typeof func !== "function") {
                throw `Argument func must be a function, not ${typeof func}!`;
            }
        
            this.keydown_binds[key] = func;
        },
        addup: (key, func) => {
            if (typeof this.keyup_binds[key] !== "undefined") {
                throw `${key} is already bound!`;
            } else if (typeof func !== "function") {
                throw `Argument func must be a function, not ${typeof func}!`;
            }
        
            this.keyup_binds[key] = func;
        },

        /* These functions return an array containing this information:
         * [keybind_exists: boolean, return_data: any]  */
        keydown_handler: event => {
            if (typeof this.keydown_binds[event.code] === "undefined")
                return [false, null];
            
            return [true, this.keydown_binds[event.code]()];
        },
        keyup_handler: event => {
            if (typeof this.keyup_binds[event.code] === "undefined")
                return [false, null];
            
                return [true, this.keyup_binds[event.code]()];
        }
    };
})();
