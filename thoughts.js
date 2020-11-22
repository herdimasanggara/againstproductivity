const btn = document.querySelector('button');
const context = new AudioContext();
let isPlaying = false;
let oscillator = null

btn.addEventListener('click', () => {
  if (isPlaying) {
  	stop();
    btn.innerText = 'SLACK OFF';
    isPlaying = false;
  } else {
    play();
    btn.innerText = 'BE PRODUCTIVE';
    isPlaying = true;
  }
})

document.body.addEventListener('mousemove', function (e) {
	if (isPlaying) {
    const frequency = calculateFrequency(e.clientY);
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
  }
});

function play() {
	oscillator = context.createOscillator();
	oscillator.connect(context.destination);
  oscillator.start();
}

function stop() {
	oscillator.stop(context.currentTime);
  oscillator.disconnect();
}

function calculateFrequency(yPos) {
	const frequency = { min: 100, max: 2000 };
  const pos = window.innerHeight - yPos;
  return ((pos / window.innerHeight) * frequency.max) + frequency.min;
};





var DiffCamEngine = (function() {
  var stream;         // stream obtained from webcam
  var video;          // shows stream
  var captureCanvas;      // internal canvas for capturing full images from video
  var captureContext;     // context for capture canvas
  var diffCanvas;       // internal canvas for diffing downscaled captures
  var diffContext;      // context for diff canvas
  var motionCanvas;     // receives processed diff images
  var motionContext;      // context for motion canvas

  var initSuccessCallback;  // called when init succeeds
  var initErrorCallback;    // called when init fails
  var startCompleteCallback;  // called when start is complete
  var captureCallback;    // called when an image has been captured and diffed

  var captureInterval;    // interval for continuous captures
  var captureIntervalTime;  // time between captures, in ms
  var captureWidth;     // full captured image width
  var captureHeight;      // full captured image height
  var diffWidth;        // downscaled width for diff/motion
  var diffHeight;       // downscaled height for diff/motion
  var isReadyToDiff;      // has a previous capture been made to diff against?
  var pixelDiffThreshold;   // min for a pixel to be considered significant
  var scoreThreshold;     // min for an image to be considered significant
  var includeMotionBox;   // flag to calculate and draw motion bounding box
  var includeMotionPixels;  // flag to create object denoting pixels with motion

  function init(options) {
    // sanity check
    if (!options) {
      throw 'No options object provided';
    }

    // incoming options with defaults
    video = options.video || document.createElement('video');
    motionCanvas = options.motionCanvas || document.createElement('canvas');
    captureIntervalTime = options.captureIntervalTime || 100;
    captureWidth = options.captureWidth || 640;
    captureHeight = options.captureHeight || 480;
    diffWidth = options.diffWidth || 64;
    diffHeight = options.diffHeight || 48;
    pixelDiffThreshold = options.pixelDiffThreshold || 32;
    scoreThreshold = options.scoreThreshold || 16;
    includeMotionBox = options.includeMotionBox || false;
    includeMotionPixels = options.includeMotionPixels || false;

    // callbacks
    initSuccessCallback = options.initSuccessCallback || function() {};
    initErrorCallback = options.initErrorCallback || function() {};
    startCompleteCallback = options.startCompleteCallback || function() {};
    captureCallback = options.captureCallback || function() {};

    // non-configurable
    captureCanvas = document.createElement('canvas');
    diffCanvas = document.createElement('canvas');
    isReadyToDiff = false;

    // prep video
    video.autoplay = true;

    // prep capture canvas
    captureCanvas.width = captureWidth;
    captureCanvas.height = captureHeight;
    captureContext = captureCanvas.getContext('2d');

    // prep diff canvas
    diffCanvas.width = diffWidth;
    diffCanvas.height = diffHeight;
    diffContext = diffCanvas.getContext('2d');

    // prep motion canvas
    motionCanvas.width = diffWidth;
    motionCanvas.height = diffHeight;
    motionContext = motionCanvas.getContext('2d');

    requestWebcam();
  }

  function requestWebcam() {
    var constraints = {
      audio: false,
      video: { width: captureWidth, height: captureHeight }
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(initSuccess)
      .catch(initError);
  }

  function initSuccess(requestedStream) {
    stream = requestedStream;
    initSuccessCallback();
  }

  function initError(error) {
    console.log(error);
    initErrorCallback();
  }

  function start() {
    if (!stream) {
      throw 'Cannot start after init fail';
    }

    // streaming takes a moment to start
    video.addEventListener('canplay', startComplete);
    video.srcObject = stream;
  }

  function startComplete() {
    video.removeEventListener('canplay', startComplete);
    captureInterval = setInterval(capture, captureIntervalTime);
    startCompleteCallback();
  }

  function stop() {
    clearInterval(captureInterval);
    video.src = '';
    motionContext.clearRect(0, 0, diffWidth, diffHeight);
    isReadyToDiff = false;
  }

  function capture() {
    // save a full-sized copy of capture
    captureContext.drawImage(video, 0, 0, captureWidth, captureHeight);
    var captureImageData = captureContext.getImageData(0, 0, captureWidth, captureHeight);

    // diff current capture over previous capture, leftover from last time
    diffContext.globalCompositeOperation = 'difference';
    diffContext.drawImage(video, 0, 0, diffWidth, diffHeight);
    var diffImageData = diffContext.getImageData(0, 0, diffWidth, diffHeight);

    if (isReadyToDiff) {
      var diff = processDiff(diffImageData);

      motionContext.putImageData(diffImageData, 0, 0);
      if (diff.motionBox) {
        motionContext.strokeStyle = '#fff';
        motionContext.strokeRect(
          diff.motionBox.x.min + 0.5,
          diff.motionBox.y.min + 0.5,
          diff.motionBox.x.max - diff.motionBox.x.min,
          diff.motionBox.y.max - diff.motionBox.y.min
        );
      }
      captureCallback({
        imageData: captureImageData,
        score: diff.score,
        hasMotion: diff.score >= scoreThreshold,
        motionBox: diff.motionBox,
        motionPixels: diff.motionPixels,
        getURL: function() {
          return getCaptureUrl(this.imageData);
        },
        checkMotionPixel: function(x, y) {
          return checkMotionPixel(this.motionPixels, x, y)
        }
      });
    }

    // draw current capture normally over diff, ready for next time
    diffContext.globalCompositeOperation = 'source-over';
    diffContext.drawImage(video, 0, 0, diffWidth, diffHeight);
    isReadyToDiff = true;
  }

  function processDiff(diffImageData) {
    var rgba = diffImageData.data;

    // pixel adjustments are done by reference directly on diffImageData
    var score = 0;
    var motionPixels = includeMotionPixels ? [] : undefined;
    var motionBox = undefined;
    for (var i = 0; i < rgba.length; i += 4) {
      var pixelDiff = rgba[i] * 0.3 + rgba[i + 1] * 0.6 + rgba[i + 2] * 0.1;
      var normalized = Math.min(255, pixelDiff * (255 / pixelDiffThreshold));
      rgba[i] = 0;
      rgba[i + 1] = normalized;
      rgba[i + 2] = 0;

      if (pixelDiff >= pixelDiffThreshold) {
        score++;
        coords = calculateCoordinates(i / 4);

        if (includeMotionBox) {
          motionBox = calculateMotionBox(motionBox, coords.x, coords.y);
        }

        if (includeMotionPixels) {
          motionPixels = calculateMotionPixels(motionPixels, coords.x, coords.y, pixelDiff);
        }

      }
    }

    return {
      score: score,
      motionBox: score > scoreThreshold ? motionBox : undefined,
      motionPixels: motionPixels
    };
  }

  function calculateCoordinates(pixelIndex) {
    return {
      x: pixelIndex % diffWidth,
      y: Math.floor(pixelIndex / diffWidth)
    };
  }

  function calculateMotionBox(currentMotionBox, x, y) {
    // init motion box on demand
    var motionBox = currentMotionBox || {
      x: { min: coords.x, max: x },
      y: { min: coords.y, max: y }
    };

    motionBox.x.min = Math.min(motionBox.x.min, x);
    motionBox.x.max = Math.max(motionBox.x.max, x);
    motionBox.y.min = Math.min(motionBox.y.min, y);
    motionBox.y.max = Math.max(motionBox.y.max, y);

    return motionBox;
  }

  function calculateMotionPixels(motionPixels, x, y, pixelDiff) {
    motionPixels[x] = motionPixels[x] || [];
    motionPixels[x][y] = true;

    return motionPixels;
  }

  function getCaptureUrl(captureImageData) {
    // may as well borrow captureCanvas
    captureContext.putImageData(captureImageData, 0, 0);
    return captureCanvas.toDataURL();
  }

  function checkMotionPixel(motionPixels, x, y) {
    return motionPixels && motionPixels[x] && motionPixels[x][y];
  }

  function getPixelDiffThreshold() {
    return pixelDiffThreshold;
  }

  function setPixelDiffThreshold(val) {
    pixelDiffThreshold = val;
  }

  function getScoreThreshold() {
    return scoreThreshold;
  }

  function setScoreThreshold(val) {
    scoreThreshold = val;
  }

  return {
    // public getters/setters
    getPixelDiffThreshold: getPixelDiffThreshold,
    setPixelDiffThreshold: setPixelDiffThreshold,
    getScoreThreshold: getScoreThreshold,
    setScoreThreshold: setScoreThreshold,

    // public functions
    init: init,
    start: start,
    stop: stop
  };
})();

var canvas          = document.getElementById('canvas');
var debug           = document.getElementById('debug');
var ctx             = canvas.getContext('2d');

var videoWidth      = canvas.width;
var videoHeight     = canvas.height;
var xCount          = videoWidth / 10;
var yCount          = videoHeight / 10;
var pixelWidth      = 4;
var pixelHeight     = 4;
var windowWidth     = window.innerWidth;
var windowHeight    = window.innerHeight;
var pixelSpacingX   = windowWidth / xCount;
var pixelSpacingY   = windowHeight / xCount;
var motionThreshold = 10;
var time            = 0;
var refreshRate     = 1000 / 60;

var opt = {
  snapDistance    : 50,
  maxLines        : 50,
  refreshAlpha    : 150,
  strokeAlpha     : 5,
  noise           : 150,
  maxLineWidth    : 500,
}

const sliders = document.querySelectorAll('.slider');
const body = document.body;
const log = console.log;
let cs = {};

const ui = {
  startDrag(){
    cs = {
      elem:  this,
      value: this.querySelector('.slider__value'),
      name:  this.getAttribute('data-name'),
      min:   Number(this.getAttribute('data-min')),
      max:   Number(this.getAttribute('data-max'))
    }

    body.addEventListener('mousemove', ui.changeSlider, false)
  },
  stopDrag(){
    body.removeEventListener('mousemove', ui.changeSlider, false)
  },
  changeSlider(e){

    // Calculate values
    const mouseDiff = e.clientX - cs.elem.getBoundingClientRect().left;
    const percent =  (mouseDiff) / cs.elem.clientWidth * 100;
    const diff = cs.max - cs.min;
    const val = Math.round(cs.min + (diff / (100 / percent)));

    // Stop sliding if percent > 100
    if(0 > percent || percent > 100) return;

    // Update UI
    cs.elem.setAttribute('data-val', val);
    cs.elem.style.paddingLeft = `${mouseDiff}px`;

    // Update value
    opt[cs.name] = val;
    log(opt);
  }
}

// Iterate through sliders
Object.keys(sliders).forEach(function(key){

  // Start drag on mousedown
  sliders[key].addEventListener('mousedown', ui.startDrag)
})

// Clear dragging on mouseup
body.addEventListener('mouseup', ui.stopDrag)



//----------------------------------------------

function initSuccess() {
  setCanvasSize();
  DiffCamEngine.start();
}

function initError() {
  alert('Something went wrong.');
}

function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}

function capture(payload) {

  time ++;
  var refreshAlpha = opt.refreshAlpha / 100;
  ctx.fillStyle = `rgba(170,160,150,${refreshAlpha})`;
  ctx.fillRect(0, 0, windowWidth, windowHeight);

  var points = [];
  var pointIndex = 0;

  payload.motionPixels.forEach(function(horizontal, x){

    horizontal.forEach(function(vertical, y){

      var pointX = Math.ceil((windowWidth - ((x + 1) * pixelSpacingX)) + ((Math.random() * opt.noise) - (opt.noise / 2))) + pixelSpacingX / 2;
      var pointY = Math.ceil((y * pixelSpacingY) + ((Math.random() * opt.noise) - (opt.noise / 2))) + pixelSpacingY / 2;

      points.push({x: pointX, y: pointY});

      // Draw lines
      if(pointIndex > 0 && pointIndex < opt.maxLines){

        for(var i = 0; i < pointIndex - 1; i++){

          var distX = Math.abs(pointX - points[i].x);
          var distY = Math.abs(pointY - points[i].y);

          var snapDistanceSin = opt.snapDistance + 100 + (Math.sin(time / 50) * opt.snapDistance);

          if(distX < snapDistanceSin && distY < snapDistanceSin){

            ctx.beginPath();
            ctx.lineWidth=Math.round(Math.random() * opt.maxLineWidth);
            ctx.strokeStyle = 'rgba(0,0,0,' + opt.strokeAlpha + ')';
            ctx.moveTo(pointX + pixelWidth / 2, pointY + pixelHeight / 2);
            ctx.lineTo(points[i].x + pixelWidth / 2, points[i].y + pixelHeight / 2 );
            ctx.stroke();

          }
        }
      }

      // Draw dot
/*       ctx.fillStyle = 'black';
      ctx.fillRect(
        pointX,
        pointY,
        pixelWidth,
        pixelHeight
      ); */

      // Next pixel
      pointIndex++;

    });
  });
}

function setCanvasSize(){

  windowWidth   = window.innerWidth;
  windowHeight  = window.innerHeight;

  canvas.width  = windowWidth;
  canvas.height = windowHeight;

  pixelSpacingX = windowWidth / xCount;
  pixelSpacingY = windowHeight / yCount;
}

DiffCamEngine.init({
  initSuccessCallback: initSuccess,
  initErrorCallback: initError,
  captureCallback: capture,
  captureIntervalTime: refreshRate,
  captureWidth: videoWidth,
  captureHeight: videoHeight,
  diffWidth: xCount,
  diffHeight: yCount,
  includeMotionPixels: true,
  pixelDiffThreshold: motionThreshold
});

window.addEventListener('resize', setCanvasSize);



$(document).ready(function() {
  animateDivfr();

});

function makeNewPositionfr() {

  // Get viewport dimensions (remove the dimension of the div)
  var hfr = $(window).height() - 100;
  var wfr = $(window).width() - 450;

  var nhfr = Math.floor(Math.random() * hfr);
  var nwfr = Math.floor(Math.random() * wfr);

  return [nhfr, nwfr];

}

function animateDivfr() {
  var newqfr = makeNewPositionfr();
  var oldqfr = $('.frustration').offset();
  var speedfr = calcSpeedfr([oldqfr.top, oldqfr.left], newqfr);

  $('.frustration').animate({
    top: newqfr[0],
    left: newqfr[1]
  }, speedfr, function() {
    animateDivfr();
  });

};

function calcSpeedfr(prevfr, nextfr) {

  var xfr = Math.abs(prevfr[1] - nextfr[1]);
  var yfr = Math.abs(prevfr[0] - nextfr[0]);

  var greatestfr = xfr > yfr ? xfr : yfr;

  var speedModifierfr = 0.5;

  var speedfr = Math.ceil(greatestfr / speedModifierfr);

  return speedfr;

}






$(document).ready(function() {
  animateDiv();

});

function makeNewPosition() {

  // Get viewport dimensions (remove the dimension of the div)
  var h = $(window).height() - 150;
  var w = $(window).width() - 150;

  var nh = Math.floor(Math.random() * h);
  var nw = Math.floor(Math.random() * w);

  return [nh, nw];

}

function animateDiv() {
  var newq = makeNewPosition();
  var oldq = $('.a').offset();
  var speed = calcSpeed([oldq.top, oldq.left], newq);

  $('.a').animate({
    top: newq[0],
    left: newq[1]
  }, speed, function() {
    animateDiv();
  });

};

function calcSpeed(prev, next) {

  var x = Math.abs(prev[1] - next[1]);
  var y = Math.abs(prev[0] - next[0]);

  var greatest = x > y ? x : y;

  var speedModifier = 0.25;

  var speed = Math.ceil(greatest / speedModifier);

  return speed;

}

$(document).ready(function() {
  animateDiv2();

});

function makeNewPosition2() {

  // Get viewport dimensions (remove the dimension of the div)
  var h2 = $(window).height() - 150;
  var w2 = $(window).width() - 150;

  var nh2 = Math.floor(Math.random() * h2);
  var nw2 = Math.floor(Math.random() * w2);

  return [nh2, nw2];

}

function animateDiv2() {
  var newq2 = makeNewPosition2();
  var oldq2 = $('.b').offset();
  var speed2 = calcSpeed2([oldq2.top, oldq2.left], newq2);

  $('.b').animate({
    top: newq2[0],
    left: newq2[1]
  }, speed2, function() {
    animateDiv2();
  });

};

function calcSpeed2(prev2, next2) {

  var x2 = Math.abs(prev2[1] - next2[1]);
  var y2 = Math.abs(prev2[0] - next2[0]);

  var greatest2 = x2 > y2 ? x2 : y2;

  var speedModifier2 = 0.25;

  var speed2 = Math.ceil(greatest2 / speedModifier2);

  return speed2;

}

$(document).ready(function() {
  animateDiv3();

});

function makeNewPosition3() {

  // Get viewport dimensions (remove the dimension of the div)
  var h3 = $(window).height() - 150;
  var w3 = $(window).width() - 150;

  var nh3 = Math.floor(Math.random() * h3);
  var nw3 = Math.floor(Math.random() * w3);

  return [nh3, nw3];

}

function animateDiv3() {
  var newq3 = makeNewPosition3();
  var oldq3 = $('.c').offset();
  var speed3 = calcSpeed3([oldq3.top, oldq3.left], newq3);

  $('.c').animate({
    top: newq3[0],
    left: newq3[1]
  }, speed3, function() {
    animateDiv3();
  });

};

function calcSpeed3(prev3, next3) {

  var x3 = Math.abs(prev3[1] - next3[1]);
  var y3 = Math.abs(prev3[0] - next3[0]);

  var greatest3 = x3 > y3 ? x3 : y3;

  var speedModifier3 = 0.25;

  var speed3 = Math.ceil(greatest3 / speedModifier3);

  return speed3;

}

$(document).ready(function() {
  animateDiv4();

});

function makeNewPosition4() {

  // Get viewport dimensions (remove the dimension of the div)
  var h4 = $(window).height() - 150;
  var w4 = $(window).width() - 150;

  var nh4 = Math.floor(Math.random() * h4);
  var nw4 = Math.floor(Math.random() * w4);

  return [nh4, nw4];

}

function animateDiv4() {
  var newq4 = makeNewPosition4();
  var oldq4 = $('.d').offset();
  var speed4 = calcSpeed4([oldq4.top, oldq4.left], newq3);

  $('.d').animate({
    top: newq4[0],
    left: newq4[1]
  }, speed4, function() {
    animateDiv4();
  });

};

function calcSpeed3(prev4, next4) {

  var x4 = Math.abs(prev4[1] - next4[1]);
  var y4 = Math.abs(prev4[0] - next4[0]);

  var greatest4 = x4 > y4 ? x4 : y4;

  var speedModifier4 = 0.25;

  var speed4 = Math.ceil(greatest4 / speedModifier4);

  return speed4;

}

$(document).ready(function() {
  animateDiv5();

});

function makeNewPosition5() {

  // Get viewport dimensions (remove the dimension of the div)
  var h5 = $(window).height() - 150;
  var w5 = $(window).width() - 150;

  var nh5 = Math.floor(Math.random() * h5);
  var nw5 = Math.floor(Math.random() * w5);

  return [nh5, nw5];

}

function animateDiv5() {
  var newq5 = makeNewPosition5();
  var oldq5 = $('.e').offset();
  var speed5 = calcSpeed5([oldq5.top, oldq5.left], newq5);

  $('.e').animate({
    top: newq4[0],
    left: newq4[1]
  }, speed5, function() {
    animateDiv5();
  });

};

function calcSpeed5(prev5, next5) {

  var x5 = Math.abs(prev5[1] - next5[1]);
  var y5 = Math.abs(prev5[0] - next5[0]);

  var greatest5 = x5 > y5 ? x5 : y5;

  var speedModifier5 = 0.25;

  var speed5 = Math.ceil(greatest5 / speedModifier5);

  return speed5;

}
