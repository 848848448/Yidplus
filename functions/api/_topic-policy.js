// Validate topic scope before any message/media write. General is SQL NULL.
export async function validateTopic(env,user,roomId,topicId) {
  if (!topicId || topicId==='general') return {ok:true,topicId:null};
  if (typeof topicId!=='string' || topicId.length>100) return {ok:false,status:400,error:'Invalid topic'};
  try {
    const room=await env.DB.prepare('SELECT type,has_topics FROM rooms WHERE id=?').bind(roomId).first();
    if (!room || room.type!=='group' || !room.has_topics) return {ok:false,status:404,error:'Topic not found'};
    const member=await env.DB.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').bind(roomId,user.id).first();
    if (!member) return {ok:false,status:403,error:'Join this group to post in a topic'};
    const topic=await env.DB.prepare('SELECT room_id,closed FROM topics WHERE id=?').bind(topicId).first();
    if (!topic || topic.room_id!==roomId) return {ok:false,status:404,error:'Topic not found'};
    if (topic.closed) return {ok:false,status:403,error:'This topic is closed'};
    return {ok:true,topicId};
  } catch {return {ok:false,status:503,error:'Topics are temporarily unavailable'};}
}
