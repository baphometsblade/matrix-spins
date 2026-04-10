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
  // Observe the full document body so recently-played, you-might-like,
  // and any other dynamically-added cards get their thumbnails applied.
  var obs = new MutationObserver(function(){ setTimeout(load,200); });
  function startObserving(){
    obs.observe(document.body,{childList:true,subtree:true});
  }
  if(document.body){
    startObserving();
  } else {
    document.addEventListener('DOMContentLoaded', startObserving);
  }
})();
