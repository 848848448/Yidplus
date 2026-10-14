// Presentation only: existing links, actions and access rules stay intact.
(function(){
 function decorate(html,kind){var t=document.createElement('template');t.innerHTML=html;var root=t.content.firstElementChild;if(!root)return html;root.classList.add(kind);if(kind==='yp-channel-post'){var card=root.firstElementChild;if(card){card.classList.add('yp-channel-card');Array.from(card.children).forEach(function(c){if(c.querySelector('audio'))c.classList.add('yp-channel-audio');});}root.querySelectorAll('audio').forEach(function(a){a.style.minWidth='0';a.setAttribute('aria-label','Play channel audio');});root.querySelectorAll('img,video').forEach(function(e){e.style.maxWidth='100%';});}return t.innerHTML;}
 var row=window._tgChannelRow;window._tgChannelRow=function(){return decorate(row.apply(this,arguments),'yp-channel-row');};
 var post=window._xPostCard;window._xPostCard=function(){return decorate(post.apply(this,arguments),'yp-channel-post');};
 var open=window.openTelegramChannel;window.openTelegramChannel=function(){open.apply(this,arguments);var feed=document.getElementById('tg-feed-scroll');if(feed)feed.classList.add('yp-channel-feed');};
})();
