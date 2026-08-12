/**
 * Reference data that ships to the browser.
 *
 * Size discipline matters here: every entry is bytes on the critical path of
 * someone else's signup page. The full disposable list is ~120k domains and
 * lives server-side in Mongo. What ships to the client is the head of the
 * distribution -- roughly the domains that cover the large majority of real
 * disposable signups -- so the widget can answer offline in the common case
 * and defer to the server for the tail.
 */

/** Mailbox providers we spell-check against. Ordered by real-world signup share. */
export const POPULAR_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'live.com', 'msn.com',
  'protonmail.com', 'proton.me', 'gmx.com', 'gmx.net', 'zoho.com',
  'yandex.com', 'mail.com', 'fastmail.com', 'hey.com', 'tutanota.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net',
  'rediffmail.com', 'yahoo.co.in', 'yahoo.co.uk', 'hotmail.co.uk',
  'googlemail.com', 'outlook.in', 'outlook.co.uk', 'ymail.com', 'rocketmail.com',
];

/** Consumer providers. Not invalid -- just a signal for B2B lead scoring. */
export const FREE_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'live.com', 'msn.com', 'gmx.com',
  'gmx.net', 'yandex.com', 'mail.com', 'rediffmail.com', 'ymail.com',
  'rocketmail.com', 'googlemail.com', 'zoho.com', 'protonmail.com', 'proton.me',
]);

/** Valid TLDs commonly mistyped, plus what they were meant to be. */
export const TLD_TYPOS = {
  con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', clm: 'com',
  comm: 'com', cim: 'com', co: 'com', om: 'com', c0m: 'com', cpm: 'com',
  nte: 'net', ner: 'net', bet: 'net', ogr: 'org', prg: 'org', orh: 'org',
};

/**
 * Head of the disposable-domain distribution. The server holds the full list.
 * Kept as an array in source (readable, diffable) and frozen into a Set below.
 */
export const TOP_DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'sharklasers.com', 'grr.la', 'guerrillamailblock.com', 'spam4.me',
  '10minutemail.com', '10minutemail.net', '20minutemail.com', '10minutemail.co.za',
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com', 'tempr.email',
  'tempmail.net', 'tempmail.plus', 'tmpmail.org', 'tmpmail.net', 'tmpeml.com',
  'throwawaymail.com', 'throwaway.email', 'trashmail.com', 'trashmail.de',
  'trashmail.net', 'trash-mail.com', 'wegwerfmail.de', 'wegwerfmail.net',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'cool.fr.nf', 'jetable.fr.nf',
  'maildrop.cc', 'mailnesia.com', 'mailcatch.com', 'mailexpire.com',
  'mailnull.com', 'mytrashmail.com', 'mt2015.com', 'mt2014.com',
  'dispostable.com', 'discard.email', 'discardmail.com', 'discardmail.de',
  'fakeinbox.com', 'fakemailgenerator.com', 'fakemail.net', 'emailfake.com',
  'getnada.com', 'nada.email', 'inboxbear.com', 'inboxkitten.com',
  'burnermail.io', 'burnertitle.com', 'spamgourmet.com', 'spambox.us',
  'spamex.com', 'spamdecoy.net', 'spamfree24.org', 'spam.la',
  'anonbox.net', 'anonymbox.com', 'antispam.de', 'armyspy.com',
  'cuvox.de', 'dayrep.com', 'einrot.com', 'fleckens.hu', 'gustr.com',
  'jourrapide.com', 'rhyta.com', 'superrito.com', 'teleworm.us',
  'mailinator.net', 'mailinator2.com', 'binkmail.com', 'bobmail.info',
  'chammy.info', 'devnullmail.com', 'letthemeatspam.com', 'mailin8r.com',
  'notmailinator.com', 'reallymymail.com', 'safetymail.info', 'sogetthis.com',
  'suremail.info', 'thisisnotmyrealemail.com', 'veryrealemail.com',
  'zippymail.info', 'mailtothis.com', 'tempinbox.com', 'tempemail.net',
  'incognitomail.org', 'deadaddress.com', 'e4ward.com', 'emailias.com',
  'emailtemporario.com.br', 'mailmoat.com', 'mailfreeonline.com',
  'mailmetrash.com', 'mailscrap.com', 'mailzilla.com', 'mailimate.com',
  'mailquack.com', 'moakt.com', 'mohmal.com', 'linshiyouxiang.net',
  'byom.de', 'dropmail.me', 'minuteinbox.com', 'emltmp.com', 'mailpoof.com',
  'harakirimail.com', 'crazymailing.com', 'instantemailaddress.com',
  'lroid.com', 'mailbox52.ga', 'mailden.net', 'mailgen.pro',
  'kurzepost.de', 'objectmail.com', 'proxymail.eu', 'rcpt.at',
  'trash2009.com', 'wh4f.org', 'zoemail.net', 'nowmymail.com',
  'tafmail.com', 'vomoto.com', 'nowhere.org', 'onemail.host',
  'muellmail.com', 'sofort-mail.de', 'squizzy.de', 'mail-temporaire.fr',
  'jetable.org', 'mailtemp.info', 'inboxalias.com', 'my10minutemail.com',
  'mailslurp.com', 'mailsac.com', 'inbox.si', 'tmail.ws', 'tmails.net',
  'luxusmail.org', 'ezztt.com', 'sute.jp', 'vipmail.in', 'mailgw.com',
  'mail-temp.com', 'temporary-mail.net', 'disposablemail.com', 'edu.tempmail.us',
]);

/**
 * Shared mailboxes, not people. Legitimate and deliverable, but for a signup
 * flow they usually mean "this is not a personal account" -- worth a nudge,
 * never a block.
 */
export const ROLE_ACCOUNTS = new Set([
  'admin', 'administrator', 'billing', 'contact', 'enquiries', 'enquiry',
  'help', 'hello', 'hi', 'hr', 'info', 'inquiries', 'it', 'jobs', 'legal',
  'mail', 'marketing', 'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'office', 'orders', 'postmaster', 'press', 'privacy', 'sales', 'security',
  'support', 'sysadmin', 'team', 'webmaster', 'abuse', 'careers', 'finance',
  'accounts', 'accounting', 'compliance', 'partners', 'feedback',
]);
