const LIMITS={bio:1000,location:120,website:500,instagram:200,youtube:500,photo_url:1000,banner_url:1000};
const FLAGS=['notif_messages','notif_likes','notif_followers','notif_channels','is_private','show_online','read_receipts'];
export function validateProfileInput(body) {
  if (!body || Array.isArray(body) || typeof body!=='object') return 'Invalid profile data';
  for (const [key,max] of Object.entries(LIMITS)) {
    if (body[key]===undefined || body[key]===null) continue;
    if (typeof body[key]!=='string' || body[key].length>max) return 'Invalid '+key.replace(/_/g,' ');
  }
  for (const key of FLAGS) if (body[key]!==undefined) {
    if (![0,1,true,false,'0','1'].includes(body[key])) return 'Invalid privacy or notification setting';
    body[key]=body[key]===1 || body[key]===true || body[key]==='1'?1:0;
  }
  if (body.nickname!==undefined && (typeof body.nickname!=='string' || body.nickname.trim().length<3 || body.nickname.trim().length>40)) return 'Nickname must be 3 to 40 characters';
  if (body.profile_color!==undefined && !/^#[0-9a-f]{6}$/i.test(body.profile_color||'')) return 'Choose a valid profile color';
  for (const key of ['website','photo_url','banner_url']) if (body[key]) {
    try {
      const url=new URL(body[key],'https://yidplus.com');
      if (!['https:','http:'].includes(url.protocol) || /["'<>\\\s]/.test(body[key])) return 'Invalid '+key.replace(/_/g,' ');
      if (key!=='website' && url.protocol!=='https:') return 'Profile images need HTTPS';
    } catch {return 'Invalid '+key.replace(/_/g,' ');}
  }
  return null;
}
export function validateProfileFile(file) {
  if (!file || !file.size || file.size>12*1024*1024) return 'Profile image must be under 12MB';
  if (!/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(file.type||'')) return 'Choose a JPG, PNG, WebP, GIF, AVIF or HEIC image';
  return null;
}
