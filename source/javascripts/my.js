$(document).ready(function() {

  function initCanvas() {
    var w = $("#header-container").width();
    var h = $("#header-container").height();

    $("#my-canvas").attr("width", w);
    $("#my-canvas").attr("height", h);

    $("#my-canvas").removeData("ca2d")
    $('#my-canvas').ca2d({
      color: function(state) {
        return state == 1 ? "#dfdfdf" : "#fafafa";
      }
    });

    $('#my-canvas').ca2d("step");
  }


  $(window).bind("resize", function() {
    initCanvas();
  });

  initCanvas();

  // determine mobile / pc
  var agent = navigator.userAgent;
  if(agent.search(/iPhone/) != -1 || agent.search(/iPad/) != -1) {
    $('#my-canvas').on("touchstart touchmove touchend", function(e) {
      e.preventDefault();
      $(this).ca2d("step");
    });
  } else {
    $('#my-canvas').on("mousemove", function(e) {
      $(this).ca2d("step");
    });
  }
});
