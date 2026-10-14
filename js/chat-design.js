/* Presentation-only enhancements. No changes to sending or privacy behavior. */
(function(){
  var search=document.querySelector('.tg-search-pill');
  if(search){search.setAttribute('role','button');search.tabIndex=0;search.setAttribute('aria-label','Search messages and people');search.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openGlobalSearch();}});}
  document.querySelectorAll('.icon-btn').forEach(function(el){if(!el.hasAttribute('tabindex'))el.tabIndex=0;if(!el.getAttribute('role'))el.setAttribute('role','button');el.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();el.click();}});});
  var input=document.getElementById('chat-input');if(input){input.placeholder='Write a message...';input.setAttribute('aria-label','Message');}
  document.querySelectorAll('#chat-settings-modal [style]').forEach(function(el){if(el.children.length===0){el.textContent=el.textContent.replace(/^[^a-zA-Z]+(?=[A-Z])/,'');}});
  var title=document.querySelector('#chat-settings-modal .modal-title');if(title)title.textContent='Chat settings';
  var labels=[['cs-dark-toggle','Dark appearance'],['cs-receipts-toggle','Read receipts']];labels.forEach(function(pair){var el=document.getElementById(pair[0]);if(el){el.setAttribute('role','switch');el.setAttribute('aria-label',pair[1]);el.tabIndex=0;el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});}});
  function sync(){
    document.querySelectorAll('.chat-item').forEach(function(el){var call=el.getAttribute('onclick')||'';var selected=typeof CHAT_curRoom!=='undefined'&&CHAT_curRoom&&call.indexOf("'"+CHAT_curRoom.id+"'")!==-1;el.classList.toggle('design-selected',!!selected);});
    labels.forEach(function(pair){var el=document.getElementById(pair[0]);if(el)el.setAttribute('aria-checked',String(el.classList.contains('on')));});
  }
  var list=document.getElementById('chat-list-area');if(list)new MutationObserver(sync).observe(list,{childList:true,subtree:true});
  var settings=document.getElementById('chat-settings-modal');if(settings)new MutationObserver(sync).observe(settings,{attributes:true,subtree:true,attributeFilter:['class']});
})();
