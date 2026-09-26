import * as cloud from './cloud.js';

const $ = (selector) => document.querySelector(selector);
const key = 'beitna:family-invite';
const token = location.hash.slice(1) || cloud.pendingFamilyInvitation();
const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
const forget = () => { try { sessionStorage.removeItem(key); } catch { /* storage disabled */ } };
function remember() { try { sessionStorage.setItem(key, token); } catch { /* The original link remains usable. */ } }
function requireLogin() {
  $('#inviteStatus').textContent = 'سجّل الدخول أو أنشئ حسابًا بنفس البريد الذي أُرسلت إليه الدعوة. ستعود هنا لتأكيد الانضمام.';
  $('#signIn').hidden = false;
}
$('#signIn').addEventListener('click', remember);
$('#cancelInvite').addEventListener('click', () => { forget(); location.replace('./'); });
$('#differentAccount').addEventListener('click', async () => {
  if (!confirm('سيتم تسجيل خروج الحساب الحالي من هذا المتصفح فقط للدخول ببريد الدعوة. هل تريد المتابعة؟')) return;
  remember(); await cloud.signOutCloud(); location.replace('./');
});
$('#acceptInvite').addEventListener('click', async () => {
  const button = $('#acceptInvite'); button.disabled = true;
  try {
    const result = await cloud.acceptEmailInvitation(token);
    forget(); history.replaceState(null, '', location.pathname);
    $('#inviteStatus').textContent = `انضممت إلى «${result.householdName}». إذا لديك أكثر من بيت، اختره من «بيوتي».`;
    button.hidden = true; $('#differentAccount').hidden = true;
    $('#openHouseholds').hidden = false;
  } catch (error) { $('#inviteStatus').textContent = cloud.arabicError(error); }
  finally { button.disabled = false; }
});

async function load() {
  if (!valid) { $('#inviteStatus').textContent = 'رابط الدعوة غير صحيح. اطلب رابطًا جديدًا من مالك البيت.'; return; }
  remember();
  try {
    await cloud.initCloud();
    if (!cloud.hasSession()) return requireLogin();
    $('#signedInEmail').textContent = cloud.currentEmail() || '';
    $('#differentAccount').hidden = false;
    const invite = await cloud.inspectEmailInvitation(token);
    $('#inviteStatus').textContent = `أنت مدعو إلى «${invite.householdName}». لا يتم الانضمام إلا بعد موافقتك. تنتهي الدعوة في ${new Date(invite.expiresAt).toLocaleDateString('ar-OM')}.`;
    $('#acceptInvite').hidden = false;
  } catch (error) {
    if (error.code === 'no-user') { await cloud.signOutCloud(); requireLogin(); }
    else $('#inviteStatus').textContent = cloud.arabicError(error);
  }
}
load();
