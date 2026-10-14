(function(){
  var old=window.openAIChat;
  window.openAIChat=function(){
    old.apply(this,arguments);
    var input=document.getElementById('ai-input');
    var send=document.getElementById('ai-send');
    var messages=document.getElementById('ai-messages');
    if(input)input.setAttribute('aria-label','Message YID PLUS AI');
    if(send)send.setAttribute('aria-label','Send message to YID PLUS AI');
    if(messages){messages.setAttribute('role','log');messages.setAttribute('aria-label','AI conversation');messages.setAttribute('aria-live','polite');}
    var close=document.querySelector('#ai-chat-screen button');if(close)close.setAttribute('aria-label','Back to chats');
    var clear=document.querySelector('#ai-chat-screen button[title="Clear"]');if(clear)clear.setAttribute('aria-label','Clear AI conversation');
  };
})();
