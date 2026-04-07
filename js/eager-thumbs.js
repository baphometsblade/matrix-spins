/* Eager thumbnail loader — bypasses broken IntersectionObserver */
(function(){
  function load(){
    var els = document.querySelectorAll('[data-bg]');
    els.forEach(function(el){
      var src = el.getAttribute('data-bg');
      if(!src) return;
      el.style.setProperty('background-image','url('+src+')','important');
      el.style.setProperty('background-size','cover','important');
      el.style.setProperty('background-position','center','important');
      el.removeAttribute('data-bg');
    });
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){ setTimeout(load,300); setTimeout(load,2000); });
  } else {
    setTimeout(load,300);
    setTimeout(load,2000);
  }
  // Also run when games grid mutates (filter/search changes cards)
  var obs = new MutationObserver(function(){ setTimeout(load,200); });
  var grid = document.querySelector('.games-grid');
  if(grid) obs.observe(grid,{childList:true,subtree:true});
  else document.addEventListener('DOMContentLoaded',function(){
    var g = document.querySelector('.games-grid');
    if(g) obs.observe(g,{childList:true,subtree:true});
  });
})();
