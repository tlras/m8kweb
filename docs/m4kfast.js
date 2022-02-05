var output = document.getElementById("output");
var blockName = document.getElementById("blockName");
var fpsCount = document.getElementById("fpsCount");
var gl = output.getContext("webgl", {
	antialias: false
});

var cameraPos =Â [11.85, -67.2, -61.12];//[-9.343005478673618, -38.099999999999994, -7.376547961840774];
var cameraRot = [1.08, -0.68];//[5.480000000000004, -0.5972036732051049];
var selectX = 0;
var selectY = 0;
var selectZ = 0;
var placeX = 0;
var placeY = 0;
var placeZ = 0;
var selectVisible = false;
var selectedBlock = 1;
var uiVisible = false;
var blockScrollingLocked = false;
var worldEdgeSelection = false;

var defaultWalkSpeed = 0.1;
var defaultRunSpeed = 0.2
var walkSpeed = defaultWalkSpeed;
var cameraSpeed = 0.008;
var pointLock = false;
var socket = null;
var canPlaceBlocks = true;

var negativePiMult2 = -(Math.PI * 2);
var negativePiDiv2 = -(Math.PI / 2);
var PiDiv2 = Math.PI / 2;
var clickTimer = 0;

function m4kIdxToXYZ(idx) {
	var x = (idx%64);
	var y = (idx%(64*64)>>6);
	var z = (idx%(64*64*64)>>12);
	return [63 - x, 63 - y, z];
}

function XYZToM4kIdx(x, y, z) {
	return (z) << 12 | (63-y) << 6 | (63-x);
}

var inittedMap = false;
var gameHasLoaded = false;
var mapSegmentsLoaded = 0;
function makeSocket() {
	socket = new WebSocket("wss://2s4.me/m4k/");
	socket.onopen = function() {
		disconMsg.style.display = "none";
		canPlaceBlocks = true;
		if(!inittedMap) {
			socket.send(JSON.stringify({
				type: "request_map"
			}));
			inittedMap = true;
		}
	}
	socket.onmessage = function(msg) {
		var res = JSON.parse(msg.data)
		
		if(res.type == "map_seg") {
			mapSegmentsLoaded++;
			console.log("Segment", mapSegmentsLoaded, 64);
			for(var i = 0; i < 4096; i++) {
				var pos = res.segment * 4096 + i;
				var mat = res.data[i];
				var xyz = m4kIdxToXYZ(pos);
				setBlock(xyz[0], xyz[1], xyz[2], mat);
			}
			if(mapSegmentsLoaded >= 64) {
				console.log("Loaded map");
				if(!gameHasLoaded) {
					gameHasLoaded = true;
					beginInputs();
				}
			}
		}
		if(res.type == "block_changed") {
			var index = res.index;
			var block = res.block;
			var xyz = m4kIdxToXYZ(index);
			setBlock(xyz[0], xyz[1], xyz[2], block);
		}
	}
	socket.onclose = function() {
		disconMsg.style.display = "";
		canPlaceBlocks = false;
		setTimeout(makeSocket, 500);
	}
}
makeSocket();

function begin() {
	if(!gl) {
		console.log("WebGL is unavailable");
	}

	var vsSource = `
	attribute vec4 aVertexPosition;
	attribute vec3 aVertexNormal;
	attribute vec2 aTextureCoord;
	attribute highp vec4 aColor;
	uniform mat4 uNormalMatrix;
	uniform mat4 uModelViewMatrix;
	uniform mat4 uProjectionMatrix;
	varying highp vec2 vTextureCoord;
	varying highp vec3 vLighting;
	varying highp vec4 vColor;
	
	//#define USE_FOG


	#ifdef USE_FOG
		varying highp vec3 vFogPosition;
	#endif
	
	void main(void) {
		vColor = aColor;
		gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
		vTextureCoord = aTextureCoord;
		// Apply lighting effect
		highp vec3 ambientLight = vec3(1, 1, 1);
		highp vec3 directionalLightColor = vec3(1, 1, 1);
		highp vec3 directionalVector = normalize(vec3(0.85, 0.8, 0.75));
		highp vec4 transformedNormal = uNormalMatrix * vec4(aVertexNormal, 1.0);
		highp float directional = max(dot(transformedNormal.xyz, directionalVector), 0.0);
		vLighting = ambientLight;// + (directionalLightColor * directional);
		
		#ifdef USE_FOG
			vFogPosition = gl_Position.xyz;
		#endif
	}

	
	
	`;

	var fsSource = `
	varying highp vec2 vTextureCoord;
	varying highp vec3 vLighting;
	uniform sampler2D uSampler;
	varying highp vec4 vColor;
	
	//#define USE_FOG
	//#define FOG_EXP2
	
	#ifdef USE_FOG
		highp vec3 fogColor;
		varying highp vec3 vFogPosition;
		#ifdef FOG_EXP2
			highp float fogDensity;
		#else
			highp float fogNear;
			highp float fogFar;
		#endif
	#endif


	#ifdef USE_FOG
		#ifdef FOG_EXP2
			#define LOG2 1.442695
			#define saturate(a) clamp( a, 0.0, 1.0 )
			#define whiteCompliment(a) ( 1.0 - saturate( a ) )
		#endif
	#endif
	
	void main(void) {
		highp vec4 texelColor = texture2D(uSampler, vTextureCoord);
		gl_FragColor = vec4(texelColor.rgb * vLighting, texelColor.a) * vColor;
		if(gl_FragColor.a < 0.5) discard;
		#ifdef USE_FOG
			fogColor = vec3(0.2, 0.2, 1.0);
		#endif
		#ifdef USE_FOG
			#ifdef FOG_EXP2
				fogDensity = 0.03;
			#else
				fogNear = 1.0;
				fogFar = 30.0;
			#endif
		#endif
		
		#ifdef USE_FOG
			highp vec3 fogPositionAbs = abs( vFogPosition );
			highp float fogMaxComponent = max( fogPositionAbs.x, max( fogPositionAbs.y, fogPositionAbs.z ) );
			highp float fogDepth = length( vFogPosition / fogMaxComponent ) * fogMaxComponent;
			#ifdef FOG_EXP2
				highp float fogFactor = whiteCompliment( exp2( - fogDensity * fogDensity * fogDepth * fogDepth * LOG2 ) );
			#else
				highp float fogFactor = smoothstep( fogNear, fogFar, fogDepth );
			#endif
			gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
		#endif
	}
	
	
	
	`;

	var shaderProgram = initShaderProgram(gl, vsSource, fsSource);

	var programInfo = {
		program: shaderProgram,
		attribLocations: {
			vertexPosition: gl.getAttribLocation(shaderProgram, "aVertexPosition"),
			vertexNormal: gl.getAttribLocation(shaderProgram, "aVertexNormal"),
			textureCoord: gl.getAttribLocation(shaderProgram, "aTextureCoord"),
			color: gl.getAttribLocation(shaderProgram, "aColor")
		},
		uniformLocations: {
			projectionMatrix: gl.getUniformLocation(shaderProgram, "uProjectionMatrix"),
			modelViewMatrix: gl.getUniformLocation(shaderProgram, "uModelViewMatrix"),
			normalMatrix: gl.getUniformLocation(shaderProgram, "uNormalMatrix"),
			uSampler: gl.getUniformLocation(shaderProgram, "uSampler")
		}
	};

	var texture = loadTexture(gl, "./texture_map.png");
	var whiteTexture = makeWhiteTexture();

	glInitFunc(programInfo, texture, whiteTexture);
	
	initSkyboxBuffer();
	initSelectionBuffer();
	initCrosshairBuffer();
	initPreviewBuffer();
	
	function frameRender() {
		drawScene(gl, programInfo, texture, whiteTexture);
		blockScrollingLocked = false;
		requestAnimationFrame(frameRender);
	}
	requestAnimationFrame(frameRender);
}

function setNextBlock() {
	blockMenuIndex++;
	if(blockMenuIndex >= BlockMenuLabel.length) blockMenuIndex = 0;
	selectedBlock = BlockMenuID[blockMenuIndex];
	updatePreviewBlock();
}

function setPrevBlock() {
	blockMenuIndex--;
	if(blockMenuIndex < 0) blockMenuIndex = BlockMenuLabel.length - 1;
	selectedBlock = BlockMenuID[blockMenuIndex];
	updatePreviewBlock();
}

var PiTimes2 = Math.PI*2;
var PiDiv2 = Math.PI / 2;
var negativePiDiv2 = -PiDiv2;
function panCameraUp(dy) {
	cameraRot[1] += Math.abs(dy) * cameraSpeed;
	if(cameraRot[1] >= PiDiv2) {
		cameraRot[1] = PiDiv2;
	}
}

function panCameraDown(dy) {
	cameraRot[1] -= Math.abs(dy) * cameraSpeed;
	if(cameraRot[1] <= negativePiDiv2) {
		cameraRot[1] = negativePiDiv2
	}
}

function panCameraLeft(dx) {
	cameraRot[0] -= Math.abs(dx) * cameraSpeed;
	cameraRot[0] = cameraRot[0] - Math.floor(cameraRot[0] / PiTimes2) * PiTimes2;
}

function panCameraRight(dx) {
	cameraRot[0] += Math.abs(dx) * cameraSpeed;
	cameraRot[0] = cameraRot[0] % PiTimes2
}

function canModifyBlock(idx) {
	var x = (idx%64);
	var y = (idx%(64*64)>>6);
	var z = (idx%(64*64*64)>>12);
	if(y >= 40 && y <= 45 && x >= 28 && x <= 34 && z >= 28 && z <= 34) return false;
	return true;
}

var MD_left = 0;
var MD_right = 0;
var CantClick = 0; // execute click, make CantClick 1, wait 500 or 250 MS and make CantClick 0. Makes sure clicks are not executed for every frame
var HCW = 0; // at first, wait 500 MS after holding mouse button down. Then repeat clicks 250 MS apart after HCW = 1

function beginInputs() {
	var up = 38;
	var down = 40;
	var left = 37;
	var right = 39;
	var w = 87;
	var a = 65;
	var s = 83;
	var d = 68;
	var shift = 16;
	var space = 32;
	
	var key_ws = 0; // w or s
	var key_ad = 0; // a or d
	var key_ss = 0; // shift space
	
	var key_ud = 0; // up or down
	var key_lr = 0; // left or right
	
	window.onkeydown = function(e) {
		var key = e.keyCode;
		switch(key) {
			case up:
				key_ud = 1;
				break;
			case down:
				key_ud = 2;
				break;
			case left:
				key_lr = 1;
				break;
			case right:
				key_lr = 2;
				break;
			case w:
				//key_ws = 1;
				W = 1;
				break;
			case a:
				//key_ad = 1;
				A = 1;
				break;
			case s:
				//key_ws = 2;
				S = 1;
				break;
			case d:
				//key_ad = 2;
				D = 1;
				break;
			case shift:
				//key_ss = 1;
				Shift = 1;
				break;
			case space:
				Jump = 1;
				//key_ss = 2;
				break;
			case 190: setNextBlock(); break;// . (>) Select next block
			case 188: setPrevBlock(); break // , (<) Select previous block
			case 88:
				walkSpeed = defaultRunSpeed;
				break;
		}
	}
	
	window.onkeyup = function(e) {
		var key = e.keyCode;
		switch(key) {
			case w:
				W = 0;
			case s:
				S = 0;
				//key_ws = 0;
				break;
			case a:
				A = 0;
			case d:
				D = 0;
				//key_ad = 0;
				break;
			case shift:
				Shift = 0;
				break;
			case space:
				Jump = 0;
				//key_ss = 0;
				break;
			case 88:
				walkSpeed = defaultWalkSpeed;
				break;
			case up:
			case down:
				key_ud = 0;
				break;
			case left:
			case right:
				key_lr = 0;
				break;
		}
	}
	
	setInterval(function() {
		/*var moved = false;
		if(key_ws == 1) { // w
			var aa = Math.sin(cameraRot[0]);
			var bb = Math.cos(cameraRot[0]);
			
			cameraPos[2] += (bb) * walkSpeed;
			cameraPos[0] -= (aa) * walkSpeed;
			moved = true;
		}
		if(key_ws == 2) { // s
			var aa = Math.sin(cameraRot[0]);
			var bb = Math.cos(cameraRot[0]);
			
			cameraPos[2] -= (bb) * walkSpeed;
			cameraPos[0] += (aa) * walkSpeed;
			moved = true;
		}
		if(key_ad == 1) { // a
			var aa = Math.sin(-cameraRot[0]);
			var bb = Math.cos(-cameraRot[0]);
			
			cameraPos[2] -= aa * walkSpeed;
			cameraPos[0] += bb * walkSpeed;
			moved = true;
		}
		if(key_ad == 2) { // d
			var aa = Math.sin(-cameraRot[0]);
			var bb = Math.cos(-cameraRot[0]);
			
			cameraPos[2] += aa * walkSpeed;
			cameraPos[0] -= bb * walkSpeed;
			moved = true;
		}
		if(key_ss == 1) { // shift
			cameraPos[1] += walkSpeed;
			moved = true;
		}
		if(key_ss == 2) { // space
			cameraPos[1] -= walkSpeed;
			moved = true;
		}*/
		if(key_ud == 1) {
			panCameraUp(8);
		} else if(key_ud == 2) {
			panCameraDown(8);
		}
		if(key_lr == 1) {
			panCameraLeft(8);
		} else if(key_lr == 2) {
			panCameraRight(8);
		}
	}, Math.floor(1000 / 32));
	
	output.requestPointerLock = output.requestPointerLock || output.mozRequestPointerLock || output.webkitRequestPointerLock;
	output.onclick = function(e) {
		if(!pointLock) {
			if(output.requestPointerLock) output.requestPointerLock();
		}
	}
	
	if ("onpointerlockchange" in document) {
		document.addEventListener("pointerlockchange", lockChangeAlert, false);
	} else if ("onmozpointerlockchange" in document) {
		document.addEventListener("mozpointerlockchange", lockChangeAlert, false);
	}
	function lockChangeAlert() {
		if(document.pointerLockElement === output ||
			document.mozPointerLockElement === output) {
			pointLock = true; // locked
		} else {
			pointLock = false; // unlocked
		}
	}
	
	output.onmousemove = function(e) {
		if(!pointLock) return;
		var dx = -e.movementX;
		var dy = -e.movementY;
		
		if (dx > 0) {
			panCameraLeft(dx);
		}
		if (dx < 0) {
			panCameraRight(dx);
		}
		if (dy > 0) {
			panCameraUp(dy);
		}
		if (dy < 0) {
			panCameraDown(dy);
		}
	}
	
	output.onmousewheel = function(e) {
		if(blockScrollingLocked) return;
		blockScrollingLocked = true; // unlock on next frame
		var delta = e.deltaY || e.wheelDelta;
		if(delta < 0) { // scroll up
			setNextBlock();
		} else {
			setPrevBlock();
		}
	}
	
	// firefox
	output.onwheel = output.onmousewheel;
	
	output.onmousedown = function(e) {
		if(e.button == 0) {
			MD_left = 1;
		} else if(e.button = 2) {
			MD_right = 1;
		}
		clickTimer = Date.now();
		HCW = 0;
		CantClick = 0
	}
	
	output.onmouseup = function(e) {
		MD_left = 0;
		MD_right = 0;
	}
	
	updatePreviewBlock();
	uiVisible = true;
	blockName.style.display = "";
	blockName.style.top = "-40px";
	var topVal = -40;
	var downAnim = setInterval(function() {
		topVal += 4;
		if(topVal >= 40) {
			topVal = 40;
			clearInterval(downAnim);
		}
		blockName.style.top = topVal + "px";
	}, 1000 / 30);
	
	setInterval(systemClockCycle, 1000 / 30);
	
	setSpawnPos();
}

function setSpawnPos() {
	cameraPos[0] = -32.5;
	cameraPos[1] = -22;
	cameraPos[2] = -31.5;
	cameraRot[0] = Math.PI;
	cameraRot[1] = 0;
}

var Jump = 0;
var W = 0;
var A = 0;
var S = 0;
var D = 0;
var n9 = 0; // move on x axis
var n10 = 0; // fall on y axis
var n11 = 0; // move on z axis
var Shift = 0;
function systemClockCycle() {
	
	
	function blockUpd(index, block) {
		socket.send(JSON.stringify({
			type: "block_upd",
			index: index,
			block: block
		}));
	}
	
	if(canPlaceBlocks) {
		var updIdx = 0;
		var updBlock = 0;
		var updNet = false;
		
		var px = placeX;
		var py = placeY;
		var pz = placeZ;
		
		var updated = -1; // if player is stuck in a wall, don't delete surrounding blocks if one block is placed
		if(MD_left && (pointLock || !output.requestPointerLock) && !MD_right) {
			var bidx = XYZToM4kIdx(selectX, selectY, selectZ);
			if(bidx >= 0 && bidx <= 64*64*64 - 1 && CantClick === 0) {
				if(canModifyBlock(bidx)) {
					setBlock(selectX, selectY, selectZ, 0);
					//blockUpd(bidx, 0);
					updIdx = bidx;
					updBlock = 0;
					updNet = true;
				}
				CantClick = 1
			}
			if(Date.now() - clickTimer >= 250 && HCW === 1) {
				CantClick = 0
				clickTimer = Date.now()
			}
			if(Date.now() - clickTimer >= 500 && HCW === 0) {
				CantClick = 0
				HCW = 1;
				clickTimer = Date.now()
			}
		}
		if(MD_right && (pointLock || !output.requestPointerLock) && !MD_left) {
			if((selectX == 0 || selectY == 0 || selectZ == 0 || selectX == 63 || selectY == 63 || selectZ == 63) && getBlock(selectX, selectY, selectZ) == 0) {
				px = selectX;
				py = selectY;
				pz = selectZ;
			}
			var bidx = XYZToM4kIdx(px, py, pz);
			if(bidx >= 0 && bidx <= 64*64*64 - 1 && CantClick === 0) {
				if(canModifyBlock(bidx)) {
					setBlock(px, py, pz, selectedBlock);
					//blockUpd(bidx, selectedBlock);
					updIdx = bidx;
					updBlock = selectedBlock;
					updNet = true;
				}
				updated = bidx
				CantClick = 1
			}
			if(Date.now() - clickTimer >= 250 && HCW === 1) {
				CantClick = 0
				clickTimer = Date.now()
			}
			if(Date.now() - clickTimer >= 500 && HCW === 0) {
				CantClick = 0
				HCW = 1;
				clickTimer = Date.now()
			}
		}
		if(updated >= 0) {
			for (var n37 = 0; n37 < 12; ++n37) { // makes sure blocks placed inside player are removed
				var n38 = (((-cameraPos[0]+1) + (n37 >> 0 & 0x1) * 0.6 - 0.3)|0) - 1
				var n39 = (((-cameraPos[1]) + ((n37 >> 2) - 1) * 0.8 + 0.65)|0) - 1
				var n40 = (((-cameraPos[2]+1) + (n37 >> 1 & 0x1) * 0.6 - 0.3)|0) - 1
				var INDEX = XYZToM4kIdx(n38, n39, n40);
				if (n38 >= 0 && n39 >= 0 && n40 >= 0 && n38 < 64 && n39 < 64 && n40 < 64 && INDEX === updated) {
					setBlock(px, py, pz, 0);
					updNet = false;
				}
			}
		}
		
		if(updNet) {
			blockUpd(updIdx, updBlock);
		}
	}
	
	
	var xCos = Math.cos(cameraRot[0]);
	var xSin = Math.sin(cameraRot[0]);
	  
	var n24 = (W - S) * walkSpeed;
	var n25 = (D - A) * walkSpeed;
	var n26 = n9 * 0.5;
	var n27 = n10 * 0.99;
	var n28 = n11 * 0.5;
	n9 = n26 + (xCos * n25 + xSin * n24);
	n10 = n27 + 0.016;
	n11 = n28 + (xSin * n25 - xCos * n24);
	var n29 = 0;

	MovePlayer: while ((n29 < 3)) { //Each loop is an axis (X, Y, Z)
		var n30 = (-cameraPos[0]+1) + n9 * (((n29 + 0) % 3 / 2 | 0));
		var n31 = (-cameraPos[1]) - n10 * (((n29 + 1) % 3 / 2 | 0));
		var n32 = (-cameraPos[2]+1) + n11 * (((n29 + 2) % 3 / 2 | 0));
		for (var n33 = 0; n33 < 12; ++n33) {
			var n34 = ((n30 + (n33 >> 0 & 1) * 0.6 - 0.3)|0) - 1;
			var n35 = ((n31 + ((n33 >> 2) - 1) * 0.8 + 0.65)|0) - 1;
			var n36 = ((n32 + (n33 >> 1 & 1) * 0.6 - 0.3)|0) - 1;
			var ax = n34;
			var ay = n35;
			var az = n36;
			var blockData = getBlock(ax, ay, az);
			if (ax < 0 || ay < 0 || az < 0 || ax >= 64 || ay >= 64 || az >= 64 || blockData > 0 || (Shift == 1 && n29 === 1)) { // Is there a collision?
				if (n29 === 1) {
					if (Jump > 0 && n10 > 0) { // if player is not in air, make player jump
						n10 = -0.23;
					} else {
						n10 = 0;
					}
				}
				++n29;
				continue MovePlayer; //Immediately stop and go back to top of the loop (if n29 < 3)
			}
		}
		cameraPos[0] = -n30+1;
		cameraPos[1] = -n31;
		cameraPos[2] = -n32+1;
		++n29;
	}
}

function setMainViewport() {
	gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}

function setPreviewViewport() {
	gl.viewport(0, gl.canvas.offsetHeight - 128, 128, 128);
}

function setCanvSize() {
	var w = window.innerWidth;
	var h = window.innerHeight;
	output.width = w;
	output.height = h;
	setMainViewport();
}

window.onresize = function() {
	setCanvSize();
}

setCanvSize();

function initShaderProgram(gl, vsSource, fsSource) {
	var vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
	var fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

	// Create the shader program

	var shaderProgram = gl.createProgram();
	gl.attachShader(shaderProgram, vertexShader);
	gl.attachShader(shaderProgram, fragmentShader);
	gl.linkProgram(shaderProgram);

	// If creating the shader program failed, alert

	if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
		alert("Unable to initialize the shader program: " + gl.getProgramInfoLog(shaderProgram));
		return null;
	}
	return shaderProgram;
}

var chunks = {};

var chunkBuffers = {};
function createChunk(x, y, z) {
	var chunkGrid = new Uint8Array(16 * 16 * 16);
	chunks[x + "," + y + "," + z] = chunkGrid;
}

function getBlock(x, y, z, a_chunkX, a_chunkY, a_chunkZ, chunk) {
	var chunkX = Math.floor(x / 16);
	var chunkY = Math.floor(y / 16);
	var chunkZ = Math.floor(z / 16);
	var blockX = x - chunkX * 16;
	var blockY = y - chunkY * 16;
	var blockZ = z - chunkZ * 16;
	if(chunk) {
		if(a_chunkX == chunkX && a_chunkY == chunkY && a_chunkZ == chunkZ) {
			return chunk[blockZ * 256 + blockY * 16 + blockX];
		}
	}
	var pos = chunkX + "," + chunkY + "," + chunkZ;
	if(!chunks[pos]) return 0;
	return chunks[pos][blockZ * 256 + blockY * 16 + blockX];
}

function setBlock(x, y, z, material) {
	var chunkX = Math.floor(x / 16);
	var chunkY = Math.floor(y / 16);
	var chunkZ = Math.floor(z / 16);
	var blockX = x - chunkX * 16;
	var blockY = y - chunkY * 16;
	var blockZ = z - chunkZ * 16;
	if(!chunks[chunkX + "," + chunkY + "," + chunkZ]) createChunk(chunkX, chunkY, chunkZ);
	var chunk = chunks[chunkX + "," + chunkY + "," + chunkZ];
	
	setChunkUpdate(chunkX, chunkY, chunkZ);
	setChunkUpdate(chunkX, chunkY+1, chunkZ);
	setChunkUpdate(chunkX, chunkY-1, chunkZ);
	setChunkUpdate(chunkX, chunkY, chunkZ+1);
	setChunkUpdate(chunkX, chunkY, chunkZ-1);
	setChunkUpdate(chunkX+1, chunkY, chunkZ);
	setChunkUpdate(chunkX-1, chunkY, chunkZ);
	
	var index = blockZ * 256 + blockY * 16 + blockX;
	chunk[index] = material;
}

function setChunkUpdate(x, y, z) {
	var pos = x + "," + y + "," + z;
	var chunk = chunks[pos];
	if(!chunk) return;
	chunkUpdates[x + "," + y + "," + z] = 1;
}

var blockMenuIndex = 0;

var BlockLabel = ["AIR","GRASS","DIRT","STONE","BRICK","WOOD","LEAVES","WATER","GLASS","GCRYSTAL","WHITE","BLACK","RED","GREEN","BLUE","ORANGE","MAGENTA","LIGHT BLUE","YELLOW","LIME","PINK","GRAY","LIGHT GRAY","CYAN","PURPLE","BROWN","FRACTAL"];
var BlockMenuLabel = ["GRASS","DIRT","STONE","BRICK","WOOD","LEAVES","WATER","GLASS","WHITE","BLACK","RED","GREEN","BLUE","ORANGE","MAGENTA","LIGHT BLUE","YELLOW","LIME","PINK","GRAY","LIGHT GRAY","CYAN","PURPLE","BROWN"];
var BlockMenuID = [1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25];


var blockVertexIndex = [
	0,  1,  2,      0,  2,  3,    // back
	4,  5,  6,      4,  6,  7,    // front
	8,  9,  10,     8,  10, 11,   // bottom
	12, 13, 14,     12, 14, 15,   // top
	16, 17, 18,     16, 18, 19,   // left
	20, 21, 22,     20, 22, 23    // right
];

var index_size = 36;
var position_offsets = [
	// Back face
	[1, 1, 0],
	[0, 1, 0],
	[0, 0, 0],
	[1, 0, 0],
	// Front face
	[1, 1, 1],
	[1, 0, 1],
	[0, 0, 1],
	[0, 1, 1],
	// Bottom face
	[1, 0, 1],
	[1, 0, 0],
	[0, 0, 0],
	[0, 0, 1],
	// Top face
	[1, 1, 1],
	[0, 1, 1],
	[0, 1, 0],
	[1, 1, 0],
	// Left face
	[0, 1, 1],
	[0, 0, 1],
	[0, 0, 0],
	[0, 1, 0],
	// Right face
	[1, 1, 1],
	[1, 1, 0],
	[1, 0, 0],
	[1, 0, 1]
];
var texture_offsets = [
	// Back
	[0, 0], // 0
	[1, 0], // 1
	[1, 1], // 2
	[0, 1], // 3
	// Front
	[1, 0], // 4
	[1, 1], // 5
	[0, 1], // 6
	[0, 0], // 7
	// Bottom
	[1, 0], // 8
	[1, 1], // 9
	[0, 1], // 10
	[0, 0], // 11
	// Top
	[1, 1], // 12
	[0, 1], // 13
	[0, 0], // 14
	[1, 0], // 15
	// Left
	[1, 0], // 16
	[1, 1], // 17
	[0, 1], // 18
	[0, 0], // 19
	// Right
	[0, 0], // 20
	[1, 0], // 21
	[1, 1], // 22
	[0, 1]  // 23
];

for(var i = 0; i < texture_offsets.length; i++) {
	var line = texture_offsets[i];
	var epsilon = 0.005;
	var u = line[0];
	var v = line[1];
	if(u == 0) line[0] += epsilon;
	if(u == 1) line[0] -= epsilon;
	if(v == 0) line[1] += epsilon;
	if(v == 1) line[1] -= epsilon;
}

var block_texmap = [ // back, front, bottom, top, left, right, IS TRANSPARENT?
	[[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], // air
	[[1, 0], [1, 0], [2, 0], [0, 0], [1, 0], [1, 0]], // grass
	[[2, 0], [2, 0], [2, 0], [2, 0], [2, 0], [2, 0]], // dirt
	[[3, 0], [3, 0], [3, 0], [3, 0], [3, 0], [3, 0]], // stone
	[[4, 0], [4, 0], [4, 0], [4, 0], [4, 0], [4, 0]], // brick
	[[12, 1], [12, 1], [5, 0], [5, 0], [12, 1], [12, 1]], // wood
	[[6, 0], [6, 0], [6, 0], [6, 0], [6, 0], [6, 0], true], // leaves
	[[7, 0], [7, 0], [7, 0], [7, 0], [7, 0], [7, 0]], // water
	[[8, 0], [8, 0], [8, 0], [8, 0], [8, 0], [8, 0], true], // glass
	[[9, 0], [9, 0], [9, 0], [9, 0], [9, 0], [9, 0]], // green crystal
	[[10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0]], // white
	[[11, 0], [11, 0], [11, 0], [11, 0], [11, 0], [11, 0]], // black
	[[12, 0], [12, 0], [12, 0], [12, 0], [12, 0], [12, 0]], // red
	[[13, 0], [13, 0], [13, 0], [13, 0], [13, 0], [13, 0]], // green
	[[14, 0], [14, 0], [14, 0], [14, 0], [14, 0], [14, 0]], // blue
	[[15, 0], [15, 0], [15, 0], [15, 0], [15, 0], [15, 0]], // orange
	[[0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]], // magenta
	[[13, 1], [13, 1], [13, 1], [13, 1], [13, 1], [13, 1]], // light blue
	[[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]], // yellow
	[[2, 1], [2, 1], [2, 1], [2, 1], [2, 1], [2, 1]], // lime
	[[3, 1], [3, 1], [3, 1], [3, 1], [3, 1], [3, 1]], // pink
	[[4, 1], [4, 1], [4, 1], [4, 1], [4, 1], [4, 1]], // gray
	[[5, 1], [5, 1], [5, 1], [5, 1], [5, 1], [5, 1]], // light gray
	[[6, 1], [6, 1], [6, 1], [6, 1], [6, 1], [6, 1]], // cyan
	[[7, 1], [7, 1], [7, 1], [7, 1], [7, 1], [7, 1]], // purple
	[[8, 1], [8, 1], [8, 1], [8, 1], [8, 1], [8, 1]], // brown
	[[10, 4], [10, 4], [10, 4], [10, 4], [10, 4], [10, 4]]  // fractal
];

function isBlockTransparent(id) {
	return !!block_texmap[id][6];
}

function shouldCull(mat, isTransp, neighBlock, neighTrans) {
	if(isTransp && neighTrans) {
		if(mat != neighBlock) return false;
		return true;
	}
	if(neighBlock && !neighTrans) {
		return true;
	}
	return false;
}

var chunkUpdates = {};

function createBuffer(chunkX, chunkY, chunkZ) {
	var chunk = chunks[chunkX + "," + chunkY + "," + chunkZ];
	
	var positions = [];
	var textureCoordinates = [];
	var colors = [];
	
	for(var i = 0; i < 16 * 16 * 16; i++) {
		var x = i % 16;
		var y = Math.floor(i / 16) % 16;
		var z = Math.floor(i / (16 * 16)) % 16;
		var mat = chunk[i];
		
		if(mat == 0) continue;
		
		var ax = x + chunkX * 16;
		var ay = y + chunkY * 16;
		var az = z + chunkZ * 16;

		for(var d = 0; d < index_size; d++) {
			var idx = blockVertexIndex[d];
			
			var side = Math.floor(idx / 4);
			
			var isTransp = !!block_texmap[mat][6];
			
			var neighBlock = null;
			if(side == 0) { // front
				neighBlock = getBlock(ax, ay, az-1, chunkX, chunkY, chunkZ, chunk); // back
			} else if(side == 1) { // back
				neighBlock = getBlock(ax, ay, az+1, chunkX, chunkY, chunkZ, chunk); // front
			} else if(side == 2) { // top
				neighBlock = getBlock(ax, ay-1, az, chunkX, chunkY, chunkZ, chunk); // bottom
			} else if(side == 3) { // bottom
				neighBlock = getBlock(ax, ay+1, az, chunkX, chunkY, chunkZ, chunk); // top
			} else if(side == 4) { // right
				neighBlock = getBlock(ax-1, ay, az, chunkX, chunkY, chunkZ, chunk); // left
			} else if(side == 5) { // left
				neighBlock = getBlock(ax+1, ay, az, chunkX, chunkY, chunkZ, chunk); // right
			}
			var neighTrans = isBlockTransparent(neighBlock);
			
			// face-to-face culling
			if(shouldCull(mat, isTransp, neighBlock, neighTrans)) {
				continue;
			}
			
			// vertex positions
			var vx = position_offsets[idx][0];
			var vy = position_offsets[idx][1];
			var vz = position_offsets[idx][2];
			positions.push(vx + x, vy + y, vz + z);
			
			var texIdx = block_texmap[mat][side];
			
			// texture coordinates
			var u = texture_offsets[idx][0];
			var v = texture_offsets[idx][1];
			u /= 16;
			v /= 16;
			var texX = texIdx[0];
			var texY = texIdx[1];
			u += texX / 16;
			v += texY / 16;
			textureCoordinates.push(u, v);
			
			// shading
			var colRGB = 1;
			var colA = 1;
			if(side == 0) { // front
				colRGB = 0.7;
			} else if(side == 1) { // back
				colRGB = 0.8;
			} else if(side == 2) { // top
				colRGB = 0.5;
			} else if(side == 3) { // bottom
				colRGB = 1;
			} else if(side == 4) { // right
				colRGB = 0.6;
			} else if(side == 5) { // left
				colRGB = 0.8;
			}
			colors.push(colRGB, colRGB, colRGB, colA);
		}
	}

	return {
		positions: new Float32Array(positions),
		textureCoordinates: new Float32Array(textureCoordinates),
		colors: new Float32Array(colors),
		x: chunkX,
		y: chunkY,
		z: chunkZ
	};
}

function makeGLBuffers(chunkBuffer) {
	// vertex positions
	var positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, chunkBuffer.positions, gl.STATIC_DRAW);

	// texture UV coordinates
	var textureCoordBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, chunkBuffer.textureCoordinates, gl.STATIC_DRAW);
	
	// block shading data
	var colorBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, chunkBuffer.colors, gl.STATIC_DRAW);

	return {
		position: positionBuffer,
		positionLen: chunkBuffer.positions.length,
		textureCoord: textureCoordBuffer,
		color: colorBuffer,
		x: chunkBuffer.x,
		y: chunkBuffer.y,
		z: chunkBuffer.z
	};
}

function updateGLBuffers(glBuffer, chunkBuffer) {
	// vertex positions
	var positionBuffer = glBuffer.position;
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, chunkBuffer.positions, gl.STATIC_DRAW);

	// texture UV coordinates
	var textureCoordBuffer = glBuffer.textureCoord;
	gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, chunkBuffer.textureCoordinates, gl.STATIC_DRAW);
	
	// block shading data
	var colorBuffer = glBuffer.color;
	gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, chunkBuffer.colors, gl.STATIC_DRAW);
	
	glBuffer.positionLen = chunkBuffer.positions.length;
	
	return glBuffer;
}

function handleChunkUpdates() {
	for(var i in chunkUpdates) {
		var buf = chunkBuffers[i];
		
		var pos = i.split(",");
		var x = parseInt(pos[0]);
		var y = parseInt(pos[1]);
		var z = parseInt(pos[2]);
		
		var bData = createBuffer(x, y, z);
		
		if(buf) {
			chunkBuffers[i] = updateGLBuffers(buf, bData);
		} else {
			chunkBuffers[i] = makeGLBuffers(bData);
		}
		delete chunkUpdates[i];
	}
}

function makeWhiteTexture() {
	var texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);

	var level = 0;
	var internalFormat = gl.RGBA;
	var width = 1;
	var height = 1;
	var border = 0;
	var srcFormat = gl.RGBA;
	var srcType = gl.UNSIGNED_BYTE;
	var pixel = new Uint8Array(width * height * 4);
	for(var y = 0; y < height; y++) {
		for(var x = 0; x < width; x++) {
			var idx = (y * width + x) * 4;
			pixel[idx + 0] = 205;
			pixel[idx + 1] = 205;
			pixel[idx + 2] = 205;
			pixel[idx + 3] = 255;
		}
	}

	gl.bindTexture(gl.TEXTURE_2D, texture);

	gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
		width, height, border, srcFormat, srcType,
		pixel);
	return texture;
}

function loadTexture(gl, url) {
	var texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);

	var level = 0;
	var internalFormat = gl.RGBA;
	var width = 1;
	var height = 1;
	var border = 0;
	var srcFormat = gl.RGBA;
	var srcType = gl.UNSIGNED_BYTE;
	var pixel = new Uint8Array(width * height * 4);
	for(var y = 0; y < height; y++) {
		for(var x = 0; x < width; x++) {
			var idx = (y * width + x) * 4;
			pixel[idx + 0] = 255;
			pixel[idx + 1] = 255;
			pixel[idx + 2] = 255;
			pixel[idx + 3] = 255;
		}
	}

	gl.bindTexture(gl.TEXTURE_2D, texture);

	gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
		width, height, border, srcFormat, srcType,
		pixel);


	var image = new Image();
	image.onload = function() {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
			srcFormat, srcType, image);

	
		gl.generateMipmap(gl.TEXTURE_2D);
	
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	};
	image.src = url;

	return texture;
}

function isPowerOf2(value) {
	return (value & (value - 1)) == 0;
}


// Skybox rendering system
var sky_positions;
var sky_uv;
var sky_color;
var sky_vec_count;

function initSkyboxBuffer() {
	var positions = new Float32Array(6 * 3 * 2 * 3);
	var uv = new Float32Array(6 * 3 * 2 * 2);
	var color = new Float32Array(6 * 3 * 2 * 4);
	
	for(var i = 0; i < index_size; i++) {
		var index = blockVertexIndex[i];
		
		var x = -position_offsets[index][0] + 1;
		var y = -position_offsets[index][1] + 1;
		var z = -position_offsets[index][2] + 1;
		
		positions[i * 3 + 0] = x;
		positions[i * 3 + 1] = y;
		positions[i * 3 + 2] = z;
		
		var u = texture_offsets[index][0];
		var v = texture_offsets[index][1];
		u /= 16;
		v /= 16;
		var texX = 7;
		var texY = 0;
		u += texX / 16;
		v += texY / 16;
		uv[i * 2 + 0] = u;
		uv[i * 2 + 1] = v;
		
		color[i * 4 + 0] = 1;
		color[i * 4 + 1] = 1;
		color[i * 4 + 2] = 1;
		color[i * 4 + 3] = 1;
	}
	
	var positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); // select buffer
	gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW); // upload to gpu based on selected buffer
	
	var textureCoordBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
	
	var colorBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, color, gl.STATIC_DRAW);
	
	sky_positions = positionBuffer;
	sky_uv = textureCoordBuffer;
	sky_color = colorBuffer;
	sky_vec_count = 6 * 3 * 2;
}

function drawSkybox(programInfo, texture, projectionMatrix) {
	var modelViewMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	
	var transX = -.5;
	var transY = -.5;
	var transZ = -.5;
	
	var rotY = [ 1.0, 0.0, 0.0 ];
	var rotX = [ 0.0, 1.0, 0.0 ];
	var pos = [ transX, transY, transZ ];
	rotate(modelViewMatrix, modelViewMatrix, -cameraRot[1], rotY);
	rotate(modelViewMatrix, modelViewMatrix, cameraRot[0], rotX);
	translate(modelViewMatrix, modelViewMatrix, pos);
	
	// pull positions
	var numComponents = 3;
	var type = gl.FLOAT;
	var normalize = false;
	var stride = 0;
	var offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, sky_positions);
	gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

	// pull texture coordinates
	numComponents = 2;
	type = gl.FLOAT;
	normalize = false;
	stride = 0;
	offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, sky_uv);
	gl.vertexAttribPointer(programInfo.attribLocations.textureCoord, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);

	// pull colors
	numComponents = 4;
	type = gl.FLOAT;
	normalize = false;
	stride = 0;
	offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, sky_color);
	gl.vertexAttribPointer(programInfo.attribLocations.color, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.color);
	
	// send matrixes to the shader program
	gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
	gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix);
	
	type = gl.UNSIGNED_SHORT;
	offset = 0;
	gl.drawArrays(gl.TRIANGLES, 0, sky_vec_count);
}

var sel_positions;
var sel_uv;
var sel_color;
var sel_vec_count;

function selectionFace(fidx, positions, uv, color, sst, thk, ssc, zOffset, revXY, X2Z, xOffset, yOffset, revYZ) {
	var cfidx = fidx * 24;
	
	// down
	addvector3_A(positions,  0 + cfidx, sst + xOffset,   0 + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions,  1 + cfidx,   0 + xOffset,   0 + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions,  2 + cfidx,   0 + xOffset, thk + yOffset, zOffset, revXY, X2Z, revYZ);

	addvector3_A(positions,  3 + cfidx, sst + xOffset,   0 + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions,  4 + cfidx,   0 + xOffset, thk + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions,  5 + cfidx, sst + xOffset, thk + yOffset, zOffset, revXY, X2Z, revYZ);

	// left
	addvector3_A(positions,  6 + cfidx, thk + xOffset, thk + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions,  7 + cfidx,   0 + xOffset, thk + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions,  8 + cfidx,   0 + xOffset, ssc + yOffset, zOffset, revXY, X2Z, revYZ);

	addvector3_A(positions,  9 + cfidx, thk + xOffset, thk + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 10 + cfidx,   0 + xOffset, ssc + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 11 + cfidx, thk + xOffset, ssc + yOffset, zOffset, revXY, X2Z, revYZ);

	// up
	addvector3_A(positions, 12 + cfidx, ssc + xOffset, sst + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 13 + cfidx, thk + xOffset, sst + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 14 + cfidx, thk + xOffset, ssc + yOffset, zOffset, revXY, X2Z, revYZ);

	addvector3_A(positions, 15 + cfidx, ssc + xOffset, sst + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 16 + cfidx, thk + xOffset, ssc + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 17 + cfidx, ssc + xOffset, ssc + yOffset, zOffset, revXY, X2Z, revYZ);

	// right
	addvector3_A(positions, 18 + cfidx, ssc + xOffset,   0 + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 19 + cfidx, sst + xOffset,   0 + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 20 + cfidx, sst + xOffset, sst + yOffset, zOffset, revXY, X2Z, revYZ);

	addvector3_A(positions, 21 + cfidx, ssc + xOffset,   0 + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 22 + cfidx, sst + xOffset, sst + yOffset, zOffset, revXY, X2Z, revYZ);
	addvector3_A(positions, 23 + cfidx, ssc + xOffset, sst + yOffset, zOffset, revXY, X2Z, revYZ);
	
	// texture uvs
	for(var i = 0; i < 4; i++) {
		var idx = i * 6 + cfidx;
		var u = 10.5 / 16;
		var v = 0;
		addvector2(uv, idx+0, u, v);
		addvector2(uv, idx+1, u, v);
		addvector2(uv, idx+2, u, v);
		
		addvector2(uv, idx+3, u, v);
		addvector2(uv, idx+4, u, v);
		addvector2(uv, idx+5, u, v);
	}
	
	// color arrays
	for(var i = 0; i < 4; i++) {
		var idx = i * 6 + cfidx;
		addvector4(color, idx+0, 1, 1, 1, 1);
		addvector4(color, idx+1, 1, 1, 1, 1);
		addvector4(color, idx+2, 1, 1, 1, 1);
		
		addvector4(color, idx+3, 1, 1, 1, 1);
		addvector4(color, idx+4, 1, 1, 1, 1);
		addvector4(color, idx+5, 1, 1, 1, 1);
	}
}

function initSelectionBuffer() {
	var faceCount = 8 * 6;
	
	var positions = new Float32Array(3 * 3 * faceCount);
	var uv = new Float32Array(2 * 3 * faceCount);
	var color = new Float32Array(4 * 3 * faceCount);
	
	var sel_size = 1 + 0.04;
	var thick = 1.0 / 16;
	
	var inverse_scale = 1;
	
	// scaled values
	var sst = (sel_size - thick) / inverse_scale;
	var thk = (thick) / inverse_scale;
	var ssc = (sel_size) / inverse_scale;
	
	selectionFace(0, positions, uv, color, sst, thk, ssc, 0, false, false, 0, 0, false);
	selectionFace(1, positions, uv, color, sst, thk, ssc, -sel_size, true, false, 0, 0, false);
	selectionFace(2, positions, uv, color, sst, thk, ssc, 0, false, true, -sel_size, 0, false);
	selectionFace(3, positions, uv, color, sst, thk, ssc, sel_size, true, true, 0, -sel_size, false);
	selectionFace(4, positions, uv, color, sst, thk, ssc, sel_size, true, true, -sel_size, 0, true);
	selectionFace(5, positions, uv, color, sst, thk, ssc, 0, true, false, 0, -sel_size, true);
	
	var positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); // select buffer
	gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW); // upload to gpu based on selected buffer
	
	var textureCoordBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
	
	var colorBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, color, gl.STATIC_DRAW);
	
	sel_positions = positionBuffer;
	sel_uv = textureCoordBuffer;
	sel_color = colorBuffer;
	sel_vec_count = faceCount * 3;
}

function drawSelection(programInfo, projectionMatrix) {
	var modelViewMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	
	var transX = cameraPos[0] + (selectX) - (0.04/2);
	var transY = cameraPos[1] + (selectY) - (0.04/2);
	var transZ = cameraPos[2] + (selectZ) + 1 + (0.04/2);
	
	var rotY = [ 1.0, 0.0, 0.0 ];
	var rotX = [ 0.0, 1.0, 0.0 ];
	var pos = [ transX, transY, transZ ];
	rotate(modelViewMatrix, modelViewMatrix, -cameraRot[1], rotY);
	rotate(modelViewMatrix, modelViewMatrix, cameraRot[0], rotX);
	translate(modelViewMatrix, modelViewMatrix, pos);
	
	// pull positions
	var numComponents = 3;
	var type = gl.FLOAT;
	var normalize = false;
	var stride = 0;
	var offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, sel_positions);
	gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

	// pull texture coordinates
	numComponents = 2;
	type = gl.FLOAT;
	normalize = false;
	stride = 0;
	offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, sel_uv);
	gl.vertexAttribPointer(programInfo.attribLocations.textureCoord, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);

	// pull colors
	numComponents = 4;
	type = gl.FLOAT;
	normalize = false;
	stride = 0;
	offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, sel_color);
	gl.vertexAttribPointer(programInfo.attribLocations.color, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.color);
	
	// send matrixes to the shader program
	gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
	gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix);
	
	type = gl.UNSIGNED_SHORT;
	offset = 0;
	gl.drawArrays(gl.TRIANGLES, 0, sel_vec_count);
}

function addvector3(pos, vecIdx, X, Y, Z) {
	pos[(3 * vecIdx) + 0] = X;
	pos[(3 * vecIdx) + 1] = Y;
	pos[(3 * vecIdx) + 2] = Z;
}
function addvector3_A(pos, vexIdx, X, Y, Z, flipXY, X2Z, revXZ) {
	if(flipXY) {
		if(X2Z) {
			if(revXZ) {
				addvector3(pos, vexIdx, Y, Z, X);
			} else {
				addvector3(pos, vexIdx, Z, X, Y);
			}
		} else {
			if(revXZ) {
				addvector3(pos, vexIdx, X, Z, Y);
			} else {
				addvector3(pos, vexIdx, Y, X, Z);
			}
		}
	} else {
		if(X2Z) {
			addvector3(pos, vexIdx, Z, Y, X);
		} else {
			addvector3(pos, vexIdx, X, Y, Z);
		}
	}
}

function addvector2(pos, vecIdx, X, Y) {
	pos[(2 * vecIdx) + 0] = X;
	pos[(2 * vecIdx) + 1] = Y;
}

function addvector4(pos, vecIdx, A, B, C, D) {
	pos[(4 * vecIdx) + 0] = A;
	pos[(4 * vecIdx) + 1] = B;
	pos[(4 * vecIdx) + 2] = C;
	pos[(4 * vecIdx) + 3] = D;
}

function calcRay() {
	var xRot = cameraRot[0];
	var yRot = cameraRot[1];
	var yCos = Math.cos(yRot);
	var ySin = Math.sin(yRot);
	var xCos = Math.cos(xRot);
	var xSin = Math.sin(xRot);

	var ox = cameraPos[0];
	var oy = cameraPos[1];
	var oz = cameraPos[2];

	var xOffset = 0; // X offset
	var yOffset = 0; // Y offset
	var zOffset = 1; // Z offset (how far forward does a ray go?)

	var zDepth = zOffset * yCos + yOffset * ySin;
	
	var _yd = (yOffset * yCos - zOffset * ySin);
	var _xd = -(xOffset * xCos + zDepth * xSin);
	var _zd = (zDepth * xCos - xOffset * xSin);

	var closest = 256;

	var currentBlock = -1;
	var posx = 0;
	var posy = 0;
	var posz = 0;
	
	var d_a = -1; // axis (x, y, z respectively)
	var n_a = -1; // face normal
	var farSelect = false;
	for (var d = 0; d < 3; d++) {
		var dimLength = _xd;
		if (d == 1)
			dimLength = _yd;
		if (d == 2)
			dimLength = _zd;

		var ll = Math.abs(dimLength);
		var xd = _xd / ll;
		var yd = _yd / ll;
		var zd = _zd / ll;

		var initial = ox - Math.floor(ox); // starting point of the ray in the block
		if (d == 1)
			initial = oy - Math.floor(oy);
		if (d == 2)
			initial = oz - Math.floor(oz);
		
		var negative = initial < 0;
			
		initial = Math.abs(initial);
		
		// is the player in a negative coordinate? make sure initial value is inverted
		if(dimLength > 0) {
			initial = 1.0 - initial;
		}

		var dist = initial / ll;

		var xp = ox + xd * initial;
		var yp = oy + yd * initial;
		var zp = oz + zd * initial;

		if (dimLength < 0) {
			if (d == 0)
				xp--;
			if (d == 1)
				yp--;
			if (d == 2)
				zp--;
		}
		
		// while ray is within limit
		while (dist < closest) {
			var xpos = yp;
			var ypos = xp;
			var zpos = zp;
			
			var cx = -Math.floor(xp+1);
			var cy = -Math.floor(yp+1);
			var cz = -Math.floor(zp+1);
			
			
			var tex = 0;
			if(cz < 63 && cy < 63 && cx < 63 && cz >= 1 && cy >= 1 && cx >= 1) {
				tex = getBlock(cx, cy, cz);
				farSelect = false;
			} else {
				tex = 1;
				farSelect = true;
			}

			if (tex > 0) {
				closest = dist;
				currentBlock = tex;
				posx = -Math.floor(xp+1);
				posy = -Math.floor(yp+1);
				posz = -Math.floor(zp+1);
				
				d_a = d;
				var NEG = 1;
				if(dimLength > 0) {
				   NEG = -1;
				}
				n_a = NEG;
			}
			
			// move the ray forward
			xp += xd;
			yp += yd;
			zp += zd;
			// increase distance count to determine if it is too far
			dist += 1.0/ll;
		}
	}
	
	if(currentBlock > -1) {
		placeX = posx;
		placeY = posy;
		placeZ = posz;
		
		if(d_a == 2) placeZ -= n_a;
		if(d_a == 1) placeY -= n_a;
		if(d_a == 0) placeX -= n_a;
		
		selectX = posx;
		selectY = posy;
		selectZ = posz;
		selectVisible = true;
		if(farSelect) {
			worldEdgeSelection = true;
		} else {
			worldEdgeSelection = false;
		}
	} else {
		selectVisible = false;
	}
}



var cross_positions;
var cross_uv;
var cross_color;
var cross_vec_count;

function initCrosshairBuffer() {
	var faceCount = 4;
	
	var thick = .03;
	var length = .3;
	
	var th = thick / 2;
	var lg = length / 2;
	
	var positions = [
		thick - th, -lg, 0,
		-th, -lg, 0,
		-th, length - lg, 0,
		
		thick - th, -lg, 0,
		-th, length - lg, 0,
		thick - th, length - lg, 0,
		
		length - lg, -th, 0,
		-lg, -th, 0,
		-lg, thick - th, 0,
		
		length - lg, -th, 0,
		-lg, thick - th, 0,
		length - lg, thick - th, 0
	];
	var uv = [
		1, 0,
		0, 0,
		0, 1,
		
		1, 0,
		0, 1,
		1, 1,
		
		1, 0,
		0, 0,
		0, 1,
		
		1, 0,
		0, 1,
		1, 1
	];
	var color = [
		1, 1, 1, 1,
		1, 1, 1, 1,
		1, 1, 1, 1,
		
		1, 1, 1, 1,
		1, 1, 1, 1,
		1, 1, 1, 1,
		
		1, 1, 1, 1,
		1, 1, 1, 1,
		1, 1, 1, 1,
		
		1, 1, 1, 1,
		1, 1, 1, 1,
		1, 1, 1, 1
	];
	
	var positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); // select buffer
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW); // upload to gpu based on selected buffer
	
	var textureCoordBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
	
	var colorBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(color), gl.STATIC_DRAW);
	
	cross_positions = positionBuffer;
	cross_uv = textureCoordBuffer;
	cross_color = colorBuffer;
	cross_vec_count = faceCount * 3;
}

function drawCrosshair(programInfo) {
	var fieldOfView = 1;
	var aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
	var zNear = 0.1;
	var zFar = 100.0;
	
	var projectionMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	
	perspective(projectionMatrix,
				fieldOfView,
				aspect,
				zNear,
				zFar);
	
	var modelViewMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	
	var transX = 0;
	var transY = 0;
	var transZ = -3;
	
	var pos = [ transX, transY, transZ ];
	translate(modelViewMatrix, modelViewMatrix, pos);
	
	// pull positions
	var numComponents = 3;
	var type = gl.FLOAT;
	var normalize = false;
	var stride = 0;
	var offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, cross_positions);
	gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

	// pull texture coordinates
	numComponents = 2;
	type = gl.FLOAT;
	normalize = false;
	stride = 0;
	offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, cross_uv);
	gl.vertexAttribPointer(programInfo.attribLocations.textureCoord, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);

	// pull colors
	numComponents = 4;
	type = gl.FLOAT;
	normalize = false;
	stride = 0;
	offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, cross_color);
	gl.vertexAttribPointer(programInfo.attribLocations.color, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.color);
	
	// send matrixes to the shader program
	gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
	gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix);
	
	type = gl.UNSIGNED_SHORT;
	offset = 0;
	gl.drawArrays(gl.TRIANGLES, 0, cross_vec_count);
}



var prev_positions;
var prev_uv;
var prev_color;
var prev_vec_count;

function generatePreviewBuffer() {
	var faceCount = 12;
	
	var positions = [];
	var uv = [];
	var color = [];
	
	var x = -0.5;
	var y = -0.5;
	var z = -0.5;

	for(var d = 0; d < index_size; d++) {
		var idx = blockVertexIndex[d];
		
		var side = Math.floor(idx / 4);
		
		// vertex positions
		var vx = position_offsets[idx][0];
		var vy = position_offsets[idx][1];
		var vz = position_offsets[idx][2];
		positions.push(vx + x, vy + y, vz + z);
		
		var texIdx = block_texmap[selectedBlock][side];
		
		// texture coordinates
		var u = texture_offsets[idx][0];
		var v = texture_offsets[idx][1];
		u /= 16;
		v /= 16;
		var texX = texIdx[0];
		var texY = texIdx[1];
		u += texX / 16;
		v += texY / 16;
		uv.push(u, v);
		
		// shading
		var colRGB = 1;
		var colA = 1;
		if(side == 0) { // front
			colRGB = 0.7;
		} else if(side == 1) { // back
			colRGB = 0.8;
		} else if(side == 2) { // top
			colRGB = 0.5;
		} else if(side == 3) { // bottom
			colRGB = 1;
		} else if(side == 4) { // right
			colRGB = 0.6;
		} else if(side == 5) { // left
			colRGB = 0.8;
		}
		color.push(colRGB, colRGB, colRGB, colA);
	}
	
	return {positions, uv, color, faceCount};
}

function initPreviewBuffer() {
	var bufs = generatePreviewBuffer();
	
	var positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); // select buffer
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bufs.positions), gl.STATIC_DRAW); // upload to gpu based on selected buffer
	
	var textureCoordBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bufs.uv), gl.STATIC_DRAW);
	
	var colorBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bufs.color), gl.STATIC_DRAW);
	
	prev_positions = positionBuffer;
	prev_uv = textureCoordBuffer;
	prev_color = colorBuffer;
	prev_vec_count = bufs.faceCount * 3;
}

function updatePreviewBlock() {
	var bufs = generatePreviewBuffer();
	
	var textureCoordBuffer = prev_uv;
	gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bufs.uv), gl.STATIC_DRAW);
	
	blockName.innerText = BlockLabel[selectedBlock];
}

function drawBlockPreview(programInfo) {
	var fieldOfView = 0.3;
	var aspect = 1;
	var zNear = 0.1;
	var zFar = 100.0;
	
	var projectionMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	
	perspective(projectionMatrix,
				fieldOfView,
				aspect,
				zNear,
				zFar);
	
	var modelViewMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	
	var transX = 0;
	var transY = 0;
	var transZ = -7;
	
	var pos = [ transX, transY, transZ ];
	translate(modelViewMatrix, modelViewMatrix, pos);
	
	rotate(modelViewMatrix,
			modelViewMatrix,
			0.5,
			[1, 0, 0]);

	rotate(modelViewMatrix,
			modelViewMatrix,
			-Math.PI/4,
			[0, 1, 0]);
	
	// pull positions
	var numComponents = 3;
	var type = gl.FLOAT;
	var normalize = false;
	var stride = 0;
	var offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, prev_positions);
	gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

	// pull texture coordinates
	numComponents = 2;
	type = gl.FLOAT;
	normalize = false;
	stride = 0;
	offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, prev_uv);
	gl.vertexAttribPointer(programInfo.attribLocations.textureCoord, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);

	// pull colors
	numComponents = 4;
	type = gl.FLOAT;
	normalize = false;
	stride = 0;
	offset = 0;
	gl.bindBuffer(gl.ARRAY_BUFFER, prev_color);
	gl.vertexAttribPointer(programInfo.attribLocations.color, numComponents, type, normalize, stride, offset);
	gl.enableVertexAttribArray(programInfo.attribLocations.color);
	
	// send matrixes to the shader program
	gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
	gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix);
	
	type = gl.UNSIGNED_SHORT;
	offset = 0;
	gl.drawArrays(gl.TRIANGLES, 0, prev_vec_count);
}



function loadShader(gl, type, source) {
	var shader = gl.createShader(type);

	gl.shaderSource(shader, source);

	gl.compileShader(shader);

	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		alert("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function perspective(out, fovy, aspect, near, far) {
	let f = 1.0 / Math.tan(fovy / 2), nf;
	out[0] = f / aspect;
	out[1] = 0;
	out[2] = 0;
	out[3] = 0;
	out[4] = 0;
	out[5] = f;
	out[6] = 0;
	out[7] = 0;
	out[8] = 0;
	out[9] = 0;
	out[11] = -1;
	out[12] = 0;
	out[13] = 0;
	out[15] = 0;
	if (far != null && far !== Infinity) {
		nf = 1 / (near - far);
		out[10] = (far + near) * nf;
		out[14] = (2 * far * near) * nf;
	} else {
		out[10] = -1;
		out[14] = -2 * near;
	}
	return out;
}

function translate(out, a, v) {
	let x = v[0], y = v[1], z = v[2];
	let a00, a01, a02, a03;
	let a10, a11, a12, a13;
	let a20, a21, a22, a23;

	if (a === out) {
		out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
		out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
		out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
		out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
	} else {
		a00 = a[0]; a01 = a[1]; a02 = a[2]; a03 = a[3];
		a10 = a[4]; a11 = a[5]; a12 = a[6]; a13 = a[7];
		a20 = a[8]; a21 = a[9]; a22 = a[10]; a23 = a[11];

		out[0] = a00; out[1] = a01; out[2] = a02; out[3] = a03;
		out[4] = a10; out[5] = a11; out[6] = a12; out[7] = a13;
		out[8] = a20; out[9] = a21; out[10] = a22; out[11] = a23;

		out[12] = a00 * x + a10 * y + a20 * z + a[12];
		out[13] = a01 * x + a11 * y + a21 * z + a[13];
		out[14] = a02 * x + a12 * y + a22 * z + a[14];
		out[15] = a03 * x + a13 * y + a23 * z + a[15];
	}

	return out;
}

function frustum(out, left, right, bottom, top, near, far) {
	var rl = 1 / (right - left),
		tb = 1 / (top - bottom),
		nf = 1 / (near - far);
	out[0] = (near * 2) * rl;
	out[1] = 0;
	out[2] = 0;
	out[3] = 0;
	out[4] = 0;
	out[5] = (near * 2) * tb;
	out[6] = 0;
	out[7] = 0;
	out[8] = (right + left) * rl;
	out[9] = (top + bottom) * tb;
	out[10] = (far + near) * nf;
	out[11] = -1;
	out[12] = 0;
	out[13] = 0;
	out[14] = (far * near * 2) * nf;
	out[15] = 0;
	return out;
}

function multiply(out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    var b0  = b[0], b1 = b[1], b2 = b[2], b3 = b[3];  
    out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    return out;
}

var glMatrixEPSILON = 0.000001

function rotate(out, a, rad, axis) {
	var x = axis[0],
		y = axis[1],
		z = axis[2];
	var len = Math.sqrt(x * x + y * y + z * z);
	var s = void 0,
		c = void 0,
		t = void 0;
	var a00 = void 0,
		a01 = void 0,
		a02 = void 0,
		a03 = void 0;
	var a10 = void 0,
		a11 = void 0,
		a12 = void 0,
		a13 = void 0;
	var a20 = void 0,
		a21 = void 0,
		a22 = void 0,
		a23 = void 0;
	var b00 = void 0,
		b01 = void 0,
		b02 = void 0;
	var b10 = void 0,
		b11 = void 0,
		b12 = void 0;
	var b20 = void 0,
		b21 = void 0,
		b22 = void 0;

	if (len < glMatrixEPSILON) {
		return null;
	}

	len = 1 / len;
	x *= len;
	y *= len;
	z *= len;

	s = Math.sin(rad);
	c = Math.cos(rad);
	t = 1 - c;

	a00 = a[0];a01 = a[1];a02 = a[2];a03 = a[3];
	a10 = a[4];a11 = a[5];a12 = a[6];a13 = a[7];
	a20 = a[8];a21 = a[9];a22 = a[10];a23 = a[11];

	// Construct the elements of the rotation matrix
	b00 = x * x * t + c;b01 = y * x * t + z * s;b02 = z * x * t - y * s;
	b10 = x * y * t - z * s;b11 = y * y * t + c;b12 = z * y * t + x * s;
	b20 = x * z * t + y * s;b21 = y * z * t - x * s;b22 = z * z * t + c;

	// Perform rotation-specific matrix multiplication
	out[0] = a00 * b00 + a10 * b01 + a20 * b02;
	out[1] = a01 * b00 + a11 * b01 + a21 * b02;
	out[2] = a02 * b00 + a12 * b01 + a22 * b02;
	out[3] = a03 * b00 + a13 * b01 + a23 * b02;
	out[4] = a00 * b10 + a10 * b11 + a20 * b12;
	out[5] = a01 * b10 + a11 * b11 + a21 * b12;
	out[6] = a02 * b10 + a12 * b11 + a22 * b12;
	out[7] = a03 * b10 + a13 * b11 + a23 * b12;
	out[8] = a00 * b20 + a10 * b21 + a20 * b22;
	out[9] = a01 * b20 + a11 * b21 + a21 * b22;
	out[10] = a02 * b20 + a12 * b21 + a22 * b22;
	out[11] = a03 * b20 + a13 * b21 + a23 * b22;

	if (a !== out) {
		// If the source and destination differ, copy the unchanged last row
		out[12] = a[12];
		out[13] = a[13];
		out[14] = a[14];
		out[15] = a[15];
	}
	return out;
}

function rotateX(out, a, rad) {
	var s = Math.sin(rad);
	var c = Math.cos(rad);
	var a10 = a[4];
	var a11 = a[5];
	var a12 = a[6];
	var a13 = a[7];
	var a20 = a[8];
	var a21 = a[9];
	var a22 = a[10];
	var a23 = a[11];

	if (a !== out) {
		// If the source and destination differ, copy the unchanged rows
		out[0] = a[0];
		out[1] = a[1];
		out[2] = a[2];
		out[3] = a[3];
		out[12] = a[12];
		out[13] = a[13];
		out[14] = a[14];
		out[15] = a[15];
	}

	// Perform axis-specific matrix multiplication
	out[4] = a10 * c + a20 * s;
	out[5] = a11 * c + a21 * s;
	out[6] = a12 * c + a22 * s;
	out[7] = a13 * c + a23 * s;
	out[8] = a20 * c - a10 * s;
	out[9] = a21 * c - a11 * s;
	out[10] = a22 * c - a12 * s;
	out[11] = a23 * c - a13 * s;
	return out;
}

function invert(out, a) {
	let a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
	let a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
	let a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
	let a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

	let b00 = a00 * a11 - a01 * a10;
	let b01 = a00 * a12 - a02 * a10;
	let b02 = a00 * a13 - a03 * a10;
	let b03 = a01 * a12 - a02 * a11;
	let b04 = a01 * a13 - a03 * a11;
	let b05 = a02 * a13 - a03 * a12;
	let b06 = a20 * a31 - a21 * a30;
	let b07 = a20 * a32 - a22 * a30;
	let b08 = a20 * a33 - a23 * a30;
	let b09 = a21 * a32 - a22 * a31;
	let b10 = a21 * a33 - a23 * a31;
	let b11 = a22 * a33 - a23 * a32;

	// Calculate the determinant
	let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

	if (!det) {
		return null;
	}
	det = 1.0 / det;

	out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
	out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
	out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
	out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
	out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
	out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
	out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
	out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
	out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
	out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
	out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
	out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
	out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
	out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
	out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
	out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

	return out;
}

function transpose(out, a) {
	// If we are transposing ourselves we can skip a few steps but have to cache some values
	if (out === a) {
		let a01 = a[1], a02 = a[2], a03 = a[3];
		let a12 = a[6], a13 = a[7];
		let a23 = a[11];
		out[1] = a[4];
		out[2] = a[8];
		out[3] = a[12];
		out[4] = a01;
		out[6] = a[9];
		out[7] = a[13];
		out[8] = a02;
		out[9] = a12;
		out[11] = a[14];
		out[12] = a03;
		out[13] = a13;
		out[14] = a23;
	} else {
		out[0] = a[0];
		out[1] = a[4];
		out[2] = a[8];
		out[3] = a[12];
		out[4] = a[1];
		out[5] = a[5];
		out[6] = a[9];
		out[7] = a[13];
		out[8] = a[2];
		out[9] = a[6];
		out[10] = a[10];
		out[11] = a[14];
		out[12] = a[3];
		out[13] = a[7];
		out[14] = a[11];
		out[15] = a[15];
	}
	return out;
}

function identity(out) {
	out[0] = 1;
	out[1] = 0;
	out[2] = 0;
	out[3] = 0;
	out[4] = 0;
	out[5] = 1;
	out[6] = 0;
	out[7] = 0;
	out[8] = 0;
	out[9] = 0;
	out[10] = 1;
	out[11] = 0;
	out[12] = 0;
	out[13] = 0;
	out[14] = 0;
	out[15] = 1;
	return out;
}

function scale(out, a, v) {
	var x = v[0], y = v[1], z = v[2];

	out[0] = a[0] * x;
	out[1] = a[1] * x;
	out[2] = a[2] * x;
	out[3] = a[3] * x;
	out[4] = a[4] * y;
	out[5] = a[5] * y;
	out[6] = a[6] * y;
	out[7] = a[7] * y;
	out[8] = a[8] * z;
	out[9] = a[9] * z;
	out[10] = a[10] * z;
	out[11] = a[11] * z;
	out[12] = a[12];
	out[13] = a[13];
	out[14] = a[14];
	out[15] = a[15];
	return out;
};

function glInitFunc(programInfo, texture) {
	gl.enable(gl.CULL_FACE);
	gl.cullFace(gl.FRONT);
	gl.enable(gl.DEPTH_TEST);
	gl.depthFunc(gl.LEQUAL);
	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	gl.clearDepth(1.0);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.enable(gl.BLEND);
	
	gl.useProgram(programInfo.program);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.uniform1i(programInfo.uniformLocations.uSampler, 0);
}

setInterval(function() {
	fpsCount.innerText = "FPS: " + framesRendered;
	framesRendered = 0;
}, 1000);

var framesRendered = 0;
function drawScene(gl, programInfo, texture, whiteTexture) {
	framesRendered++;
	setMainViewport();
	handleChunkUpdates();
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	var fieldOfView = 80 * Math.PI / 180;   // in radians
	var aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
	var zNear = 0.1;
	var zFar = 256;
	var projectionMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);


	perspective(projectionMatrix,
				fieldOfView,
				aspect,
				zNear,
				zFar);
				
	function degToRad(degrees) {
		return degrees * Math.PI / 180;
	}

	var camPosX = cameraPos[0];
	var camPosY = cameraPos[1];
	var camPosZ = cameraPos[2];
	var camRotX = cameraRot[0];
	var camRotY = cameraRot[1];
	

	gl.bindTexture(gl.TEXTURE_2D, texture);
	drawSkybox(programInfo, texture, projectionMatrix);
	gl.clear(gl.DEPTH_BUFFER_BIT);
	
	if(uiVisible) {
		gl.bindTexture(gl.TEXTURE_2D, whiteTexture);
		calcRay();
		if(selectVisible) {
			drawSelection(programInfo, projectionMatrix);
		}
		gl.bindTexture(gl.TEXTURE_2D, texture);
	}
	
	// upload camera information to shader
	gl.uniformMatrix4fv(
			programInfo.uniformLocations.projectionMatrix, // location
			false, // transpose (rows are columns of original matrix)
			projectionMatrix); // value


	for(var i in chunkBuffers) {
		
		var buffers = chunkBuffers[i];
		
		var modelViewMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
		
			
		rotate(modelViewMatrix,  // destination matrix
				modelViewMatrix,  // matrix to rotate
				-camRotY, // amount to rotate in radians
				[1, 0, 0]);       // axis to rotate around (X)

		rotate(modelViewMatrix,  // destination matrix
				modelViewMatrix,  // matrix to rotate
				camRotX, // amount to rotate in radians
				[0, 1, 0]);       // axis to rotate around (X)

		translate(modelViewMatrix,     // destination matrix
				modelViewMatrix,     // matrix to translate
				[camPosX + buffers.x * 16, camPosY + buffers.y * 16, camPosZ + buffers.z * 16]);  // amount to translate

		var normalMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
		invert(normalMatrix, modelViewMatrix);
		transpose(normalMatrix, normalMatrix);
		
		gl.uniformMatrix4fv(
			programInfo.uniformLocations.modelViewMatrix,
			false,
			modelViewMatrix);
		
		
		
		
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
		gl.vertexAttribPointer(
			programInfo.attribLocations.vertexPosition,
			3, // numComponents
			gl.FLOAT, // type
			false, // normalize
			0, // stride
			0); // offset
		gl.enableVertexAttribArray(
			programInfo.attribLocations.vertexPosition);



		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.textureCoord);
		gl.vertexAttribPointer(
			programInfo.attribLocations.textureCoord,
			2, // numComponents
			gl.FLOAT, // type
			false, // normalize
			0, // stride
			0); // offset
		gl.enableVertexAttribArray(
			programInfo.attribLocations.textureCoord);
			
			
			
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
		gl.vertexAttribPointer(
			programInfo.attribLocations.color,
			4, // numComponents
			gl.FLOAT, // type
			false, // normalize
			0, // stride
			0); // offset
		gl.enableVertexAttribArray(
			programInfo.attribLocations.color);
			
		

		// draw the arrays on screen
		gl.drawArrays(gl.TRIANGLES, 0, buffers.positionLen / 3);
	}
	
	if(uiVisible) {
		gl.disable(gl.DEPTH_TEST);
		gl.bindTexture(gl.TEXTURE_2D, whiteTexture);
		drawCrosshair(programInfo);
		
		gl.bindTexture(gl.TEXTURE_2D, texture);
		setPreviewViewport();
		drawBlockPreview(programInfo);
		
		gl.enable(gl.DEPTH_TEST);
	}
}

begin();
