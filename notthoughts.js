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

  var speedModifier2 = 0.5;

  var speed2 = Math.ceil(greatest2 / speedModifier2);

  return speed2;
  2

}
