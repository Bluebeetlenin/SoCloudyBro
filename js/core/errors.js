// -- ERROR CODES --------------------------------------------------------------
// Every error message a user can actually SEE (toasts, inline error text under
// form fields, the "needs attention" banner, the file-scan note, the remote
// sign-out alert) carries a stable code of the form SCB-<AREA>-<NN>.
//
//   * <AREA> is the subsystem (AUTH, MSG, FILE, ...) — see SCB_ERROR_AREAS.
//   * <NN>   is a fixed two-digit number inside that subsystem. A given
//            failure always renders the same code, so two users hitting the
//            same bug can compare codes, and a bug report can name one.
//
// Codes are assigned ONCE and never renumbered: when you add a new error,
// append the next free number in its area rather than re-using or shifting an
// existing one. Register it in SCB_ERROR_CODES below so the full list stays
// discoverable from inside this file.
//
// Render every user-facing error through scbErr(), which produces:
//   [SCB-MSG-05] Your message couldn't be sent — the server rejected or failed
//   the write. (details: PERMISSION_DENIED)
// The human-readable sentence and the raw technical detail stay separate, so a
// non-technical user gets a plain explanation and a developer still gets the
// underlying error out of the same string.
const SCB_ERROR_AREAS = {
  ADMIN: 'Admin tools',
  ASST: 'Cloudy voice assistant',
  AUTH: 'Sign-in / session',
  CALL: 'Calls & voice channels',
  CONT: 'Contacts / blocking',
  FAM: 'Parental controls & child accounts',
  FILE: 'File upload / attachments',
  GAME: 'Games',
  GRP: 'Groups, channels, roles & polls',
  LINK: 'Account linking (Google / Syntax)',
  MEET: 'Meetings (LiveKit rooms)',
  MSG: 'Messaging',
  RECOV: 'Account recovery / security questions',
  SCAN: 'File threat scanning',
  SEC: 'Security settings (PIN, 2FA, devices, deletion)',
  SET: 'Settings & personalisation',
  SIGNUP: 'Sign-up',
  SYS: 'Platform / self-healing',
};
const SCB_ERROR_CODES = {
  'SCB-ADMIN-01': {area:'Admin tools', meaning:'Admin-only action attempted by a non-admin account'},
  'SCB-ADMIN-02': {area:'Admin tools', meaning:'Admin panel action blocked: not the site administrator'},
  'SCB-ADMIN-03': {area:'Admin tools', meaning:'Ban/unban: no user found with that account number'},
  'SCB-ADMIN-04': {area:'Admin tools', meaning:'Banning a user threw'},
  'SCB-ADMIN-05': {area:'Admin tools', meaning:'Unbanning a user threw'},
  'SCB-ADMIN-06': {area:'Admin tools', meaning:'Verify badge: no user found with that account number'},
  'SCB-ADMIN-07': {area:'Admin tools', meaning:'Granting a verified badge threw'},
  'SCB-ADMIN-08': {area:'Admin tools', meaning:'Removing a verified badge threw'},
  'SCB-ADMIN-09': {area:'Admin tools', meaning:'Admin profile reset: no user selected'},
  'SCB-ADMIN-10': {area:'Admin tools', meaning:'Admin profile reset: selected user record not found'},
  'SCB-ADMIN-11': {area:'Admin tools', meaning:'Admin profile reset threw while writing the cleared profile'},
  'SCB-ADMIN-12': {area:'Admin tools', meaning:'Admin profile reset: no user found with that account number'},
  'SCB-ADMIN-13': {area:'Admin tools', meaning:'Admin tool blocked: not the site administrator'},
  'SCB-ADMIN-14': {area:'Admin tools', meaning:'Sending the weekly digest email threw'},
  'SCB-ADMIN-15': {area:'Admin tools', meaning:'Reports export requested with no reports on file'},
  'SCB-ADMIN-16': {area:'Admin tools', meaning:'Building or downloading the reports export threw'},
  'SCB-ADMIN-17': {area:'Admin tools', meaning:'Saving a change to the admin reports list threw'},
  'SCB-ADMIN-18': {area:'Admin tools', meaning:'Admin panel: building a reported user\'s detail view threw'},
  'SCB-ADMIN-19': {area:'Admin tools', meaning:'Admin dashboard: loading the stats tab threw'},
  'SCB-ADMIN-20': {area:'Admin tools', meaning:'Admin dashboard: loading the users tab threw'},
  'SCB-ADMIN-21': {area:'Admin tools', meaning:'Admin dashboard: loading the groups tab threw'},
  'SCB-ADMIN-22': {area:'Admin tools', meaning:'Admin dashboard: loading the reports tab threw'},
  'SCB-ASST-01': {area:'Cloudy voice assistant', meaning:'Cloudy unavailable: no speech recognition in this browser'},
  'SCB-ASST-02': {area:'Cloudy voice assistant', meaning:'Cloudy blocked: account setup not finished'},
  'SCB-ASST-03': {area:'Cloudy voice assistant', meaning:'Cloudy blocked: microphone permission denied'},
  'SCB-ASST-04': {area:'Cloudy voice assistant', meaning:'Starting Cloudy threw'},
  'SCB-ASST-05': {area:'Cloudy voice assistant', meaning:'Cloudy poll command blocked: polls are group-only'},
  'SCB-ASST-06': {area:'Cloudy voice assistant', meaning:'Cloudy could not match the spoken command'},
  'SCB-ASST-07': {area:'Cloudy voice assistant', meaning:'Cloudy send blocked: that chat is PIN-locked'},
  'SCB-ASST-08': {area:'Cloudy voice assistant', meaning:'Cloudy send aborted: the target chat could not be opened'},
  'SCB-ASST-09': {area:'Cloudy voice assistant', meaning:'Cloudy send: no message text heard'},
  'SCB-ASST-10': {area:'Cloudy voice assistant', meaning:'Cloudy send: no contact matched that name'},
  'SCB-ASST-11': {area:'Cloudy voice assistant', meaning:'Cloudy direct-message send threw'},
  'SCB-ASST-12': {area:'Cloudy voice assistant', meaning:'Cloudy open-chat: no contact matched that name'},
  'SCB-ASST-13': {area:'Cloudy voice assistant', meaning:'Cloudy open-group: no group matched that name'},
  'SCB-ASST-14': {area:'Cloudy voice assistant', meaning:'Cloudy group send: no message text heard'},
  'SCB-ASST-15': {area:'Cloudy voice assistant', meaning:'Cloudy group send: no group matched that name'},
  'SCB-ASST-16': {area:'Cloudy voice assistant', meaning:'Cloudy group-message send threw'},
  'SCB-ASST-17': {area:'Cloudy voice assistant', meaning:'Cloudy poll command: no group matched that name'},
  'SCB-ASST-18': {area:'Cloudy voice assistant', meaning:'Cloudy call command: no contact matched that name'},
  'SCB-ASST-19': {area:'Cloudy voice assistant', meaning:'Cloudy hang-up command: not currently in a call'},
  'SCB-ASST-20': {area:'Cloudy voice assistant', meaning:'Cloudy mute command: not currently in a call'},
  'SCB-ASST-21': {area:'Cloudy voice assistant', meaning:'Cloudy screen-share command: not in a call or voice channel'},
  'SCB-ASST-22': {area:'Cloudy voice assistant', meaning:'Cloudy voice-channel command: no group chat open'},
  'SCB-ASST-23': {area:'Cloudy voice assistant', meaning:'Cloudy voice-channel command: this group has no voice channels'},
  'SCB-ASST-24': {area:'Cloudy voice assistant', meaning:'Cloudy channel switch: no channel matched that name'},
  'SCB-ASST-25': {area:'Cloudy voice assistant', meaning:'Cloudy block command: no contact matched that name'},
  'SCB-ASST-26': {area:'Cloudy voice assistant', meaning:'Cloudy reminder command: no chat open'},
  'SCB-ASST-27': {area:'Cloudy voice assistant', meaning:'Cloudy reminder command: the spoken time could not be parsed'},
  'SCB-ASST-28': {area:'Cloudy voice assistant', meaning:'Saving a Cloudy reminder threw'},
  'SCB-ASST-29': {area:'Cloudy voice assistant', meaning:'Cloudy command needs an open chat (mark read)'},
  'SCB-ASST-30': {area:'Cloudy voice assistant', meaning:'Cloudy command needs an open chat (summarise)'},
  'SCB-ASST-31': {area:'Cloudy voice assistant', meaning:'Cloudy command needs an open chat (read out)'},
  'SCB-ASST-32': {area:'Cloudy voice assistant', meaning:'Cloudy read-out: there are no messages in this chat'},
  'SCB-AUTH-01': {area:'Sign-in / session', meaning:'This device was signed out remotely by another session'},
  'SCB-AUTH-08': {area:'Sign-in / session', meaning:'Login by number: number missing or below 1000'},
  'SCB-AUTH-09': {area:'Sign-in / session', meaning:'Login by email: address missing or malformed'},
  'SCB-AUTH-10': {area:'Sign-in / session', meaning:'Login: password field left empty'},
  'SCB-AUTH-11': {area:'Sign-in / session', meaning:'Login: no account exists for that number or email'},
  'SCB-AUTH-12': {area:'Sign-in / session', meaning:'Login: account is banned/suspended'},
  'SCB-AUTH-13': {area:'Sign-in / session', meaning:'Login: account is marked deleted'},
  'SCB-AUTH-14': {area:'Sign-in / session', meaning:'Login: password did not match'},
  'SCB-AUTH-15': {area:'Sign-in / session', meaning:'Login threw while reading the account or writing the session'},
  'SCB-AUTH-16': {area:'Sign-in / session', meaning:'Email-setup step reached with no pending setup session'},
  'SCB-AUTH-17': {area:'Sign-in / session', meaning:'Email setup: address missing or malformed'},
  'SCB-AUTH-18': {area:'Sign-in / session', meaning:'Email setup: address already belongs to another account'},
  'SCB-AUTH-19': {area:'Sign-in / session', meaning:'Email setup threw while saving the address'},
  'SCB-AUTH-20': {area:'Sign-in / session', meaning:'2FA code step reached with no pending 2FA session'},
  'SCB-AUTH-21': {area:'Sign-in / session', meaning:'2FA code is not six digits'},
  'SCB-AUTH-22': {area:'Sign-in / session', meaning:'2FA code incorrect at login'},
  'SCB-AUTH-23': {area:'Sign-in / session', meaning:'2FA verification threw while checking the code'},
  'SCB-AUTH-24': {area:'Sign-in / session', meaning:'Signed out because the account was suspended while in use'},
  'SCB-AUTH-25': {area:'Sign-in / session', meaning:'Login: the server could not be reached to check the password'},
  'SCB-AUTH-26': {area:'Sign-in / session', meaning:'Login: the server locked sign-in after too many failed attempts'},
  'SCB-CALL-01': {area:'Calls & voice channels', meaning:'Voice channel unavailable: no microphone API in this browser/context'},
  'SCB-CALL-02': {area:'Calls & voice channels', meaning:'Voice channel join could not get the microphone'},
  'SCB-CALL-03': {area:'Calls & voice channels', meaning:'Screen share blocked: not in a voice channel'},
  'SCB-CALL-04': {area:'Calls & voice channels', meaning:'Screen share unavailable: getDisplayMedia not supported here'},
  'SCB-CALL-05': {area:'Calls & voice channels', meaning:'Call blocked: already in a call'},
  'SCB-CALL-06': {area:'Calls & voice channels', meaning:'Call blocked: the conversation is blocked either way'},
  'SCB-CALL-07': {area:'Calls & voice channels', meaning:'Starting a 1:1 call threw'},
  'SCB-CALL-08': {area:'Calls & voice channels', meaning:'Incoming/outgoing calls unavailable: Firebase rules block the calls path'},
  'SCB-CALL-09': {area:'Calls & voice channels', meaning:'Call ended because audio could not be started on this device'},
  'SCB-CONT-01': {area:'Contacts / blocking', meaning:'Add contact attempted before account setup finished'},
  'SCB-CONT-02': {area:'Contacts / blocking', meaning:'Add contact: number missing or below 1000'},
  'SCB-CONT-03': {area:'Contacts / blocking', meaning:'Add contact: that is your own account number'},
  'SCB-CONT-04': {area:'Contacts / blocking', meaning:'Add contact: already in your contact list'},
  'SCB-CONT-05': {area:'Contacts / blocking', meaning:'Add contact: that number is not registered'},
  'SCB-CONT-06': {area:'Contacts / blocking', meaning:'Add contact threw while looking up or saving the contact'},
  'SCB-CONT-07': {area:'Contacts / blocking', meaning:'Add contact rejected for a known reason (blocked, unregistered, invalid)'},
  'SCB-CONT-08': {area:'Contacts / blocking', meaning:'CSV import: no valid account numbers found in the file'},
  'SCB-CONT-09': {area:'Contacts / blocking', meaning:'Syncing a block/unblock change to the server threw'},
  'SCB-FAM-01': {area:'Parental controls & child accounts', meaning:'Checking parent/guardian approval status threw'},
  'SCB-FAM-02': {area:'Parental controls & child accounts', meaning:'Approve child: that account no longer exists'},
  'SCB-FAM-03': {area:'Parental controls & child accounts', meaning:'Approving a child account threw'},
  'SCB-FAM-04': {area:'Parental controls & child accounts', meaning:'Denying a child account threw'},
  'SCB-FAM-05': {area:'Parental controls & child accounts', meaning:'Action blocked by a parental restriction on this account'},
  'SCB-FAM-06': {area:'Parental controls & child accounts', meaning:'Managing a child profile blocked: own account is not age-verified as 18+'},
  'SCB-FAM-07': {area:'Parental controls & child accounts', meaning:'Restriction change: that account no longer exists'},
  'SCB-FAM-08': {area:'Parental controls & child accounts', meaning:'Restriction change blocked: you do not manage that account'},
  'SCB-FAM-09': {area:'Parental controls & child accounts', meaning:'Saving a parental restriction threw'},
  'SCB-FAM-10': {area:'Parental controls & child accounts', meaning:'Create child profile blocked: own account not age-verified as 18+'},
  'SCB-FAM-11': {area:'Parental controls & child accounts', meaning:'Create child profile: display name left empty'},
  'SCB-FAM-12': {area:'Parental controls & child accounts', meaning:'Create child profile: account number outside 1000-99999'},
  'SCB-FAM-13': {area:'Parental controls & child accounts', meaning:'Create child profile: password shorter than 8 characters'},
  'SCB-FAM-14': {area:'Parental controls & child accounts', meaning:'Create child profile: date of birth left empty'},
  'SCB-FAM-15': {area:'Parental controls & child accounts', meaning:'Create child profile: account number already taken'},
  'SCB-FAM-16': {area:'Parental controls & child accounts', meaning:'Creating a child profile threw'},
  'SCB-FAM-17': {area:'Parental controls & child accounts', meaning:'Link parent: parent account number left empty'},
  'SCB-FAM-18': {area:'Parental controls & child accounts', meaning:'Link parent: that is your own account number'},
  'SCB-FAM-19': {area:'Parental controls & child accounts', meaning:'Link parent: parent password left empty'},
  'SCB-FAM-20': {area:'Parental controls & child accounts', meaning:'Link parent: parental PIN not 4-8 digits'},
  'SCB-FAM-21': {area:'Parental controls & child accounts', meaning:'Link parent: no account found with that number'},
  'SCB-FAM-22': {area:'Parental controls & child accounts', meaning:'Link parent: that account is not verified as 18 or older'},
  'SCB-FAM-23': {area:'Parental controls & child accounts', meaning:'Link parent: parent password incorrect'},
  'SCB-FAM-24': {area:'Parental controls & child accounts', meaning:'Link parent: own account record not found on the server'},
  'SCB-FAM-25': {area:'Parental controls & child accounts', meaning:'Linking a parent threw while saving'},
  'SCB-FAM-26': {area:'Parental controls & child accounts', meaning:'Unlink parent: parental PIN left empty'},
  'SCB-FAM-27': {area:'Parental controls & child accounts', meaning:'Unlink parent: own account record not found on the server'},
  'SCB-FAM-28': {area:'Parental controls & child accounts', meaning:'Unlink parent: parental PIN incorrect'},
  'SCB-FAM-29': {area:'Parental controls & child accounts', meaning:'Unlinking a parent threw while saving'},
  'SCB-FAM-30': {area:'Parental controls & child accounts', meaning:'Loading the managed (child) accounts list threw'},
  'SCB-FILE-01': {area:'File upload / attachments', meaning:'File attach attempted with no conversation open'},
  'SCB-FILE-02': {area:'File upload / attachments', meaning:'Attachment rejected: larger than the 500MB cap'},
  'SCB-FILE-03': {area:'File upload / attachments', meaning:'Starting the upload to Firebase Storage threw'},
  'SCB-FILE-04': {area:'File upload / attachments', meaning:'Upload rejected by Firebase Storage rules (storage/unauthorized)'},
  'SCB-FILE-05': {area:'File upload / attachments', meaning:'Upload task failed part-way through'},
  'SCB-FILE-06': {area:'File upload / attachments', meaning:'Upload finished but attaching it to the chat threw'},
  'SCB-GAME-01': {area:'Games', meaning:'Game start blocked: no chat open'},
  'SCB-GAME-02': {area:'Games', meaning:'Game setup cancelled: word must be 2-20 letters only'},
  'SCB-GAME-03': {area:'Games', meaning:'Game setup cancelled: no other players in this chat'},
  'SCB-GAME-04': {area:'Games', meaning:'Game setup cancelled: no valid player chosen'},
  'SCB-GAME-05': {area:'Games', meaning:'Game join blocked: the game is already full'},
  'SCB-GAME-06': {area:'Games', meaning:'Game start blocked: not enough players yet'},
  'SCB-GRP-01': {area:'Groups, channels, roles & polls', meaning:'Group creation attempted before account setup finished'},
  'SCB-GRP-02': {area:'Groups, channels, roles & polls', meaning:'Create group: group name left empty'},
  'SCB-GRP-03': {area:'Groups, channels, roles & polls', meaning:'Create group: no members selected'},
  'SCB-GRP-04': {area:'Groups, channels, roles & polls', meaning:'Saving a channel emoji change threw'},
  'SCB-GRP-05': {area:'Groups, channels, roles & polls', meaning:'Channel creation blocked: not a group admin'},
  'SCB-GRP-06': {area:'Groups, channels, roles & polls', meaning:'Add channel blocked: not a group admin'},
  'SCB-GRP-07': {area:'Groups, channels, roles & polls', meaning:'Add channel: channel name left empty'},
  'SCB-GRP-08': {area:'Groups, channels, roles & polls', meaning:'Creating a channel threw'},
  'SCB-GRP-09': {area:'Groups, channels, roles & polls', meaning:'Renaming a channel threw'},
  'SCB-GRP-10': {area:'Groups, channels, roles & polls', meaning:'Deleting a channel threw'},
  'SCB-GRP-11': {area:'Groups, channels, roles & polls', meaning:'Saving a new channel order threw'},
  'SCB-GRP-12': {area:'Groups, channels, roles & polls', meaning:'Group rename blocked: not a group admin'},
  'SCB-GRP-13': {area:'Groups, channels, roles & polls', meaning:'Add members blocked: not a group admin'},
  'SCB-GRP-14': {area:'Groups, channels, roles & polls', meaning:'Add group members blocked: not a group admin'},
  'SCB-GRP-15': {area:'Groups, channels, roles & polls', meaning:'Add group members: no contacts selected'},
  'SCB-GRP-16': {area:'Groups, channels, roles & polls', meaning:'Adding group members threw'},
  'SCB-GRP-17': {area:'Groups, channels, roles & polls', meaning:'Member management blocked: not a group admin'},
  'SCB-GRP-18': {area:'Groups, channels, roles & polls', meaning:'Member action blocked: cannot target yourself'},
  'SCB-GRP-19': {area:'Groups, channels, roles & polls', meaning:'Role assignment blocked: no roles exist in this group yet'},
  'SCB-GRP-20': {area:'Groups, channels, roles & polls', meaning:'Role assignment blocked: not a group admin'},
  'SCB-GRP-21': {area:'Groups, channels, roles & polls', meaning:'Role creation blocked: not a group admin'},
  'SCB-GRP-22': {area:'Groups, channels, roles & polls', meaning:'Create role: role name left empty'},
  'SCB-GRP-23': {area:'Groups, channels, roles & polls', meaning:'Role deletion blocked: not a group admin'},
  'SCB-GRP-24': {area:'Groups, channels, roles & polls', meaning:'Poll creation blocked: polls are group-only'},
  'SCB-GRP-25': {area:'Groups, channels, roles & polls', meaning:'Poll option limit reached'},
  'SCB-GRP-26': {area:'Groups, channels, roles & polls', meaning:'Create poll: question left empty'},
  'SCB-GRP-27': {area:'Groups, channels, roles & polls', meaning:'Create poll: fewer than two options given'},
  'SCB-GRP-28': {area:'Groups, channels, roles & polls', meaning:'Create poll blocked: you are not a member of that conversation'},
  'SCB-GRP-29': {area:'Groups, channels, roles & polls', meaning:'Deleting a group threw'},
  'SCB-GRP-30': {area:'Groups, channels, roles & polls', meaning:'Sending a channel invite threw'},
  'SCB-GRP-31': {area:'Groups, channels, roles & polls', meaning:'Share to group failed: owning group of this voice channel not found'},
  'SCB-GRP-32': {area:'Groups, channels, roles & polls', meaning:'Posting to the group threw'},
  'SCB-GRP-50': {area:'Groups, channels, roles & polls', meaning:'Badge creation/edit blocked: not a server admin'},
  'SCB-GRP-51': {area:'Groups, channels, roles & polls', meaning:'Create badge: badge name left empty'},
  'SCB-GRP-52': {area:'Groups, channels, roles & polls', meaning:'Create badge: automatic criteria given an invalid day count'},
  'SCB-GRP-53': {area:'Groups, channels, roles & polls', meaning:'Badge deletion blocked: not a server admin'},
  'SCB-GRP-54': {area:'Groups, channels, roles & polls', meaning:'Badge grant/revoke blocked: not a server admin'},
  'SCB-LINK-01': {area:'Account linking (Google / Syntax)', meaning:'Google sign-in: the credential response could not be decoded'},
  'SCB-LINK-02': {area:'Account linking (Google / Syntax)', meaning:'Google sign-in: credential response unreadable (inline login error)'},
  'SCB-LINK-03': {area:'Account linking (Google / Syntax)', meaning:'Google sign-in: the matched account is suspended'},
  'SCB-LINK-04': {area:'Account linking (Google / Syntax)', meaning:'Google sign-in: the matched account is deleted'},
  'SCB-LINK-05': {area:'Account linking (Google / Syntax)', meaning:'Google sign-in threw while verifying the Google account'},
  'SCB-LINK-06': {area:'Account linking (Google / Syntax)', meaning:'Google link blocked: that Google account is linked to another SoCloudyBro account'},
  'SCB-LINK-07': {area:'Account linking (Google / Syntax)', meaning:'Google link blocked: this account already has a different Google account linked'},
  'SCB-LINK-08': {area:'Account linking (Google / Syntax)', meaning:'Saving the Google account link threw'},
  'SCB-LINK-09': {area:'Account linking (Google / Syntax)', meaning:'Google unlink: own account record not found on the server'},
  'SCB-LINK-10': {area:'Account linking (Google / Syntax)', meaning:'Removing the Google account link threw'},
  'SCB-LINK-11': {area:'Account linking (Google / Syntax)', meaning:'Syntax Account linking unavailable: syntax-account.js did not load'},
  'SCB-LINK-12': {area:'Account linking (Google / Syntax)', meaning:'Syntax link: SDK not loaded at submit time'},
  'SCB-LINK-13': {area:'Account linking (Google / Syntax)', meaning:'Syntax link: account number outside 1000-99999'},
  'SCB-LINK-14': {area:'Account linking (Google / Syntax)', meaning:'Syntax link: password left empty'},
  'SCB-LINK-15': {area:'Account linking (Google / Syntax)', meaning:'Syntax unlink: nothing was changed'},
  'SCB-LINK-16': {area:'Account linking (Google / Syntax)', meaning:'Syntax link threw while verifying or saving the link'},
  'SCB-LINK-17': {area:'Account linking (Google / Syntax)', meaning:'Syntax unlink: own account record not found on the server'},
  'SCB-LINK-18': {area:'Account linking (Google / Syntax)', meaning:'Removing the Syntax Account link threw'},
  'SCB-LINK-19': {area:'Account linking (Google / Syntax)', meaning:'Google sign-in rejected: the verification Worker said the token is not valid'},
  'SCB-LINK-20': {area:'Account linking (Google / Syntax)', meaning:'Google sign-in: the verification Worker could not be reached or answered unusably'},
  'SCB-MEET-01': {area:'Meetings (LiveKit rooms)', meaning:'Join meeting: meeting code left empty'},
  'SCB-MEET-02': {area:'Meetings (LiveKit rooms)', meaning:'Disconnected from the meeting room'},
  'SCB-MEET-03': {area:'Meetings (LiveKit rooms)', meaning:'Meeting blocked: already in a meeting'},
  'SCB-MEET-04': {area:'Meetings (LiveKit rooms)', meaning:'Meetings unavailable in this browser'},
  'SCB-MEET-05': {area:'Meetings (LiveKit rooms)', meaning:'Meeting join failed: microphone access refused'},
  'SCB-MEET-06': {area:'Meetings (LiveKit rooms)', meaning:'Meeting join threw while connecting to the room'},
  'SCB-MEET-07': {area:'Meetings (LiveKit rooms)', meaning:'Meeting screen share unavailable in this browser'},
  'SCB-MEET-08': {area:'Meetings (LiveKit rooms)', meaning:'Sending a meeting chat message failed'},
  'SCB-MEET-09': {area:'Meetings (LiveKit rooms)', meaning:'Opening the meeting room threw'},
  'SCB-MSG-01': {area:'Messaging', meaning:'Opening a conversation threw while loading its messages'},
  'SCB-MSG-02': {area:'Messaging', meaning:'Attachment blocked: the conversation is blocked either way'},
  'SCB-MSG-03': {area:'Messaging', meaning:'Attachment send aborted: the open conversation is no longer valid'},
  'SCB-MSG-04': {area:'Messaging', meaning:'Sending an attachment message threw'},
  'SCB-MSG-05': {area:'Messaging', meaning:'Voice messages unavailable: no microphone API in this browser/context'},
  'SCB-MSG-06': {area:'Messaging', meaning:'Voice message recording could not get the microphone'},
  'SCB-MSG-07': {area:'Messaging', meaning:'Forwarding a message threw'},
  'SCB-MSG-08': {area:'Messaging', meaning:'Saving a message edit threw'},
  'SCB-MSG-09': {area:'Messaging', meaning:'Chat export requested with no messages in the conversation'},
  'SCB-MSG-10': {area:'Messaging', meaning:'Building or downloading the data export threw'},
  'SCB-MSG-11': {area:'Messaging', meaning:'Report blocked: reports only apply to direct messages'},
  'SCB-MSG-12': {area:'Messaging', meaning:'Report: description of the issue left empty'},
  'SCB-MSG-13': {area:'Messaging', meaning:'Submitting an abuse report threw'},
  'SCB-MSG-14': {area:'Messaging', meaning:'Chat deleted locally but the server write failed'},
  'SCB-MSG-15': {area:'Messaging', meaning:'A single message could not be rendered in the chat list'},
  'SCB-MSG-16': {area:'Messaging', meaning:'Text send blocked: the conversation is blocked either way'},
  'SCB-MSG-17': {area:'Messaging', meaning:'Text send aborted: the open conversation is no longer valid'},
  'SCB-MSG-18': {area:'Messaging', meaning:'Sending a text message threw'},
  'SCB-MSG-19': {area:'Messaging', meaning:'Open-tab limit reached'},
  'SCB-MSG-20': {area:'Messaging', meaning:'Restoring a tab failed: that conversation is no longer in the list'},
  'SCB-MSG-21': {area:'Messaging', meaning:'Attachment not sent: the conversation is blocked'},
  'SCB-MSG-22': {area:'Messaging', meaning:'Ping blocked: the conversation is blocked either way'},
  'SCB-MSG-23': {area:'Messaging', meaning:'Forward blocked: the destination chat is locked'},
  'SCB-MSG-24': {area:'Messaging', meaning:'Sending a ping threw'},
  'SCB-MSG-25': {area:'Messaging', meaning:'Outbox flush: a queued message\'s content was gone (never persisted before an app restart)'},
  'SCB-MSG-26': {area:'Messaging', meaning:'Deleting a message/thread failed: the server rejected the write'},
  'SCB-MSG-27': {area:'Messaging', meaning:'A scheduled message could not be delivered (target chat gone, or the send itself failed)'},
  'SCB-RECOV-01': {area:'Account recovery / security questions', meaning:'Security questions: both slots use the same question'},
  'SCB-RECOV-02': {area:'Account recovery / security questions', meaning:'Security questions: one or both answers left blank'},
  'SCB-RECOV-03': {area:'Account recovery / security questions', meaning:'Security questions threw while saving'},
  'SCB-RECOV-04': {area:'Account recovery / security questions', meaning:'Recovery: account number missing or invalid'},
  'SCB-RECOV-05': {area:'Account recovery / security questions', meaning:'Recovery: no account found with that number'},
  'SCB-RECOV-06': {area:'Account recovery / security questions', meaning:'Recovery: account has no security questions configured'},
  'SCB-RECOV-07': {area:'Account recovery / security questions', meaning:'Recovery threw while looking up that account number'},
  'SCB-RECOV-08': {area:'Account recovery / security questions', meaning:'Recovery: one or both security answers wrong'},
  'SCB-RECOV-09': {area:'Account recovery / security questions', meaning:'Recovery threw while checking the security answers'},
  'SCB-RECOV-10': {area:'Account recovery / security questions', meaning:'Recovery: new password shorter than 8 characters'},
  'SCB-RECOV-11': {area:'Account recovery / security questions', meaning:'Recovery threw while saving the new password'},
  'SCB-RECOV-12': {area:'Account recovery / security questions', meaning:'Recovery: server-side re-verification of the security answers failed (couldn\'t mint a real session for the write that follows)'},
  'SCB-SCAN-01': {area:'File threat scanning', meaning:'Download note: no scanning proxy is configured on this site'},
  'SCB-SCAN-02': {area:'File threat scanning', meaning:'Download note: nothing scannable was resolved for this attachment'},
  'SCB-SCAN-03': {area:'File threat scanning', meaning:'Scan result: scanner reported it is unconfigured'},
  'SCB-SCAN-04': {area:'File threat scanning', meaning:'Scan result: scanner is rate limited, file not checked'},
  'SCB-SCAN-05': {area:'File threat scanning', meaning:'Scan result: scanner returned an error'},
  'SCB-SCAN-06': {area:'File threat scanning', meaning:'Scan request threw before returning a result'},
  'SCB-SEC-01': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Revoking a device session threw'},
  'SCB-SEC-02': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Signing out all other devices threw'},
  'SCB-SEC-07': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'2FA setup: code entered is not six digits'},
  'SCB-SEC-08': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'2FA setup: code did not verify against the new secret'},
  'SCB-SEC-09': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'2FA setup threw while enabling two-factor authentication'},
  'SCB-SEC-10': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Disabling two-factor authentication threw'},
  'SCB-SEC-11': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Account deletion blocked: no PIN is set on this device'},
  'SCB-SEC-12': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Account deletion: typed number does not match own account number'},
  'SCB-SEC-13': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Account deletion: PIN incorrect'},
  'SCB-SEC-14': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Account deletion threw while scheduling the deletion'},
  'SCB-SEC-15': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Cancelling a scheduled account deletion threw'},
  'SCB-SEC-16': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'App lock screen: PIN incorrect'},
  'SCB-SEC-17': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'PIN setup: confirmation PIN did not match the first entry'},
  'SCB-SEC-18': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'PIN setup: fewer than 4 digits entered'},
  'SCB-SEC-19': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Chat lock blocked: no PIN is set on this device'},
  'SCB-SEC-20': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Locked chat: PIN incorrect'},
  'SCB-SEC-21': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'Encrypted export failed'},
  'SCB-SEC-22': {area:'Security settings (PIN, 2FA, devices, deletion)', meaning:'E2E key rotation failed'},
  'SCB-SET-01': {area:'Settings & personalisation', meaning:'Edit profile: display name left empty'},
  'SCB-SET-02': {area:'Settings & personalisation', meaning:'Weather location: nothing entered'},
  'SCB-SET-03': {area:'Settings & personalisation', meaning:'Weather location: no match returned by the geocoder'},
  'SCB-SET-04': {area:'Settings & personalisation', meaning:'Weather location lookup threw'},
  'SCB-SET-05': {area:'Settings & personalisation', meaning:'Speech-to-text input unsupported in this browser'},
  'SCB-SET-06': {area:'Settings & personalisation', meaning:'Speech-to-text input failed to start (microphone permissions)'},
  'SCB-SET-07': {area:'Settings & personalisation', meaning:'Do Not Disturb toggle failed to persist to localStorage'},
  'SCB-SET-08': {area:'Settings & personalisation', meaning:'Quiet hours settings failed to persist to localStorage'},
  'SCB-SIGNUP-01': {area:'Sign-up', meaning:'Sign-up blocked because the device is age-blocked'},
  'SCB-SIGNUP-02': {area:'Sign-up', meaning:'Sign-up: display name left empty'},
  'SCB-SIGNUP-03': {area:'Sign-up', meaning:'Sign-up: email missing or malformed'},
  'SCB-SIGNUP-04': {area:'Sign-up', meaning:'Sign-up: account number outside 1000-99999'},
  'SCB-SIGNUP-05': {area:'Sign-up', meaning:'Sign-up: password left empty'},
  'SCB-SIGNUP-06': {area:'Sign-up', meaning:'Sign-up: password shorter than 8 characters'},
  'SCB-SIGNUP-07': {area:'Sign-up', meaning:'Sign-up: date of birth left empty'},
  'SCB-SIGNUP-08': {area:'Sign-up', meaning:'Sign-up: date of birth unparseable'},
  'SCB-SIGNUP-09': {area:'Sign-up', meaning:'Sign-up under 18: parent/guardian email missing or malformed'},
  'SCB-SIGNUP-10': {area:'Sign-up', meaning:'Sign-up under 18: parent email same as own email'},
  'SCB-SIGNUP-11': {area:'Sign-up', meaning:'Sign-up blocked by device/IP blacklist'},
  'SCB-SIGNUP-12': {area:'Sign-up', meaning:'Sign-up: chosen account number already taken'},
  'SCB-SIGNUP-13': {area:'Sign-up', meaning:'Sign-up: an account already exists with that email'},
  'SCB-SIGNUP-14': {area:'Sign-up', meaning:'Sign-up: that Google account is already linked elsewhere'},
  'SCB-SIGNUP-15': {area:'Sign-up', meaning:'Sign-up threw while creating the account record'},
  'SCB-SYS-01': {area:'Platform / self-healing', meaning:'Message polling blocked: Firebase is rejecting reads (database rules)'},
  'SCB-SYS-02': {area:'Platform / self-healing', meaning:'Message polling failing for a non-permission reason (network/transient)'},
  'SCB-SYS-03': {area:'Platform / self-healing', meaning:'Firebase rejected requests: database rules or permissions misconfigured'},
  'SCB-SYS-04': {area:'Platform / self-healing', meaning:'Self-heal could not fix a failure and the admin alert email also failed to send'},
  'SCB-SYS-05': {area:'Platform / self-healing', meaning:'Self-heal admin alert threw before it could be sent'},
  'SCB-SYS-06': {area:'Platform / self-healing', meaning:'Unhandled promise rejection caught by global self-healing hook'},
  'SCB-SYS-07': {area:'Platform / self-healing', meaning:'Uncaught global JS error caught by self-healing hook'},
  'SCB-ADMIN-23': {area:'Admin tools', meaning:'Failed to load Firebase Realtime Database rules from the rules proxy Worker'},
  'SCB-ADMIN-24': {area:'Admin tools', meaning:'Failed to push Firebase Realtime Database rules via the rules proxy Worker'},
  'SCB-ADMIN-25': {area:'Admin tools', meaning:'Firebase data cleanup operation failed'},
  'SCB-ADMIN-26': {area:'Admin tools', meaning:'Firebase diagnosis scan failed'},
  'SCB-SIGNUP-CAP': {area:'Sign-up', meaning:'Captcha answer missing or incorrect — the security puzzle must be solved to create an account'},
};
// Format a user-facing error string. `code` is an SCB-* key above, `message` is
// the plain-English sentence, `detail` is optional raw technical context (an
// exception message, a Firebase error code, a subsystem label...).
function scbErr(code, message, detail){
  const msg = (message == null || message === '') ? 'Something failed and no further detail was reported.' : String(message);
  let out = (code ? '[' + code + '] ' : '') + msg;
  if(detail != null && detail !== ''){
    const d = (typeof detail === 'string') ? detail : ((detail && detail.message) || String(detail));
    // Don't repeat the detail when the message already contains it verbatim.
    if(d && msg.indexOf(d) === -1) out += ' (details: ' + d + ')';
  }
  return out;
}
// Look a code up in the registry — handy from the console and for support
// replies: scbErrInfo('SCB-MSG-05') -> {area, meaning}
function scbErrInfo(code){
  return SCB_ERROR_CODES[String(code||'').trim().toUpperCase()] || null;
}
// Pull the SCB-* code back out of an already-formatted message.
function scbErrCodeOf(text){
  const m = /\[(SCB-[A-Z]+-[A-Z0-9]+)\]/.exec(String(text||''));
  return m ? m[1] : null;
}
// -- END ERROR CODES ----------------------------------------------------------

// -- SELF-HEALING ERROR RECOVERY ----------------------------------------------
// Looked up by exact code, then by category prefix ('SCB-CALL'), then
// DEFAULT. `extends` lets many codes share one policy (e.g. every
// getUserMedia call site) without duplicating it. `retry`/`instructionIfUnrecoverable`
// can read `opts` (the same opts object the call site passed to selfHeal),
// which is how a strategy gets at call-site-specific data like a message id.
const SCB_RECOVERY_STRATEGIES = {
  'SCB-MSG-18': { // sendMsg() — something broke while preparing/sending a message.
    // No retry here: this is the OUTER catch, reached only when something
    // failed before/around the write itself (key derivation, encryption,
    // membership checks...) — the write's own network-blip case is already
    // handled separately, right at the saveConvos() call, by queueing the
    // message in the offline outbox. Blindly re-running this whole function
    // risks a duplicate send against whatever partial state was left behind.
    maxRetries: 0,
    instructionIfUnrecoverable: (err) => isConfigFailure(err)
      ? 'Messages can\'t be sent right now — the server is rejecting writes. This looks like a site configuration problem, not something retrying fixes. The site owner has been notified.'
      : 'Your message couldn\'t be sent ('+(err&&err.message||'unknown error')+').',
  },
  'SCB-MSG-04': { extends: 'SCB-MSG-18' }, // sendFileMsg — same shape

  'SCB-MSG-01': { // opening a chat failed to load its messages
    maxRetries: 1,
    instructionIfUnrecoverable: (err) => isConfigFailure(err)
      ? 'This chat can\'t load right now — the server is rejecting reads. This looks like a site configuration problem, not something retrying fixes. The site owner has been notified.'
      : 'This chat couldn\'t load. Check your connection and try opening it again.',
  },

  'SCB-GETUSERMEDIA': { // shared by every mic/camera call site
    maxRetries: 0, // never auto-retry a permission prompt
    instructionIfUnrecoverable: (err) => ({
      NotAllowedError:  'Camera/microphone access was blocked. Click the camera/lock icon in your address bar, allow access, then try again.',
      NotFoundError:    'No camera or microphone was found on this device.',
      NotReadableError: 'Your camera/microphone is already in use by another app — close it and try again.',
    }[err&&err.name] || ('Camera/microphone access failed'+(err&&err.name?' ('+err.name+')':'')+'.')),
  },
  'SCB-CALL-02':  { extends: 'SCB-GETUSERMEDIA' },
  'SCB-MSG-06':   { extends: 'SCB-GETUSERMEDIA' },
  'SCB-MEET-05':  { extends: 'SCB-GETUSERMEDIA' },
  'SCB-ASST-03':  { extends: 'SCB-GETUSERMEDIA' },

  DEFAULT: { // every code not listed above — same shape the old 5-regex-branch
             // version tried to cover, minus the two branches (network/auth)
             // that could never fire because no call site ever passed retryFn.
    maxRetries: 0,
    instructionIfUnrecoverable: (err) => {
      const msg=(err&&err.message)||String(err||'');
      if (/v2:|ciphertext|invalid|decrypt/i.test(msg)) {
        if (typeof healMeFields === 'function' && healMeFields(me)) return null; // healed, no instruction needed
      }
      if (/localstorage|quota/i.test(msg)) {
        // Narrower than the old /storage/ regex, which also matched Firebase
        // Cloud Storage upload errors (storage/unauthorized etc.) and wiped
        // ALL of localStorage — session, PIN, prefs, cached keys — for an
        // unrelated file-upload permission problem.
        try{ localStorage.clear(); return 'Local storage was full or corrupted and has been cleared — you may need to log in again.'; }
        catch(e2){ /* fall through to generic message below */ }
      }
      // selfHeal() itself separately detects isConfigFailure(err) right after
      // calling this (to flagNeedsAttention + notifyAdminByEmail), but this
      // function's RETURN VALUE is what the user actually sees, and it never
      // checked the same thing — every code that falls through to DEFAULT
      // (which is most selfHeal() call sites: AUTH-15, SIGNUP-15, every
      // ADMIN-*, the global error/rejection hooks, and anything not
      // explicitly listed above) told the user "try again" even on a
      // config/permission failure that retrying can never fix, while the
      // explicitly-defined SCB-MSG-18 strategy got this right. Match it here.
      if (isConfigFailure(err)) {
        return 'This looks like a site configuration or permissions problem, not something retrying fixes. The site owner has been notified.';
      }
      return 'Something went wrong and couldn\'t be fixed automatically'+(msg?': '+msg:'')+'. Try again; if it keeps happening, tell the site owner.';
    },
  },
};
// Declared here, right next to selfHeal() which reads it, rather than only
// at its later original declaration site (~line 20650, inside the
// withRetry/handleSubsystemFailure block much further down the same
// script). `let` bindings aren't hoisted the way `function` declarations
// are — they exist in the temporal dead zone until their declaration line
// actually runs — so any error thrown during this script's own synchronous
// top-to-bottom execution, before that later line had run, would have hit
// a ReferenceError inside selfHeal() itself (via the global error/
// unhandledrejection hooks a few lines below, which call selfHeal for
// exactly that kind of early failure) instead of being handled.
let _selfHealNotifiedFor = {};
function _resolveRecoveryStrategy(code){
  let s = SCB_RECOVERY_STRATEGIES[code];
  const seen = new Set();
  while (s && s.extends && !seen.has(s.extends)) { seen.add(s.extends); s = { ...SCB_RECOVERY_STRATEGIES[s.extends], ...s }; }
  return s || SCB_RECOVERY_STRATEGIES.DEFAULT;
}
// selfHeal(code, err, opts) — called from any significant catch block.
// Retries the action (opts.retryFn, or the strategy's own `retry`) a bounded
// number of times per the matched strategy, then — if still unhealed — works
// out a specific instruction instead of a generic error, and for a config/
// permission failure also escalates via the existing flagNeedsAttention/
// notifyAdminByEmail path (the same one withRetry()/handleSubsystemFailure()
// already use for getBin/putBin) since that's not something the user can fix
// themselves. Returns {healed, note} — callers should await this and use
// `note` for their error toast instead of composing their own, so a healed
// retry doesn't ALSO show a "failed" toast right behind it.
async function selfHeal(code, err, opts = {}) {
  const { retryFn, context = '', silent = false } = opts;
  const strategy = _resolveRecoveryStrategy(code);
  const fn = retryFn || strategy.retry;
  const willRetry = !!fn && strategy.maxRetries > 0 && !isUnretryable(err);
  if (!silent && willRetry) showToast('🔧 Self-Healing', 'Attempting to auto-fix — please wait…');
  let healed = false, note = '';
  const msgOf = e => (e && e.message) || String(e || '');

  try {
    if (willRetry) {
      for (let i = 0; i < strategy.maxRetries && !healed; i++) {
        await scbSleep((strategy.backoffMs ? strategy.backoffMs(i) : 800 * (i + 1)));
        try { await fn(opts); healed = true; } catch (e2) { err = e2; }
      }
    }
    if (!healed) {
      const instr = strategy.instructionIfUnrecoverable;
      note = typeof instr === 'function' ? instr(err) : instr;
      if (note === null) { healed = true; } // e.g. DEFAULT's inline healMeFields repair
      else if (isConfigFailure(err)) {
        flagNeedsAttention(scbErr(code, note));
        if (!_selfHealNotifiedFor[context||code]) {
          _selfHealNotifiedFor[context||code] = true;
          notifyAdminByEmail('SoCloudyBro: '+(context||code)+' is failing',
            'Code: '+code+'\nContext: '+(context||'(none)')+'\nError: '+msgOf(err)+'\nUser: #'+((me&&me.number)||'unknown')+'\nTime: '+new Date().toISOString()+
            '\n\nThis looks like a configuration/permission problem — retries can\'t fix it.');
        }
      }
    }
  } catch (healErr) {
    note = 'Self-healing itself failed: ' + msgOf(healErr);
  }

  if (!silent) {
    if (healed && fn) showToast('✅ Fixed automatically', context ? ('Recovered from a problem in '+context+'.') : 'Recovered automatically.');
    // else: the caller shows its own toast using `note` — no separate "Self-Healing" toast for the common no-retry-available case.
  }
  if (typeof _logError === 'function') _logError(code, msgOf(err), err&&err.stack?String(err.stack).slice(0,400):null, context, healed);
  return { healed, note };
}

// Global unhandled-rejection / error hooks — catch anything that slipped
// through a try/catch and attempt self-healing automatically.
window.addEventListener('unhandledrejection', e => {
  const err = e.reason;
  _logError('SCB-SYS-06', (err&&err.message)||String(err||''), null, 'unhandledRejection', false, err&&err.stack);
  selfHeal('SCB-SYS-06', err, { silent: false });
  console.error('[SCB unhandled rejection]', err);
  e.preventDefault();
});
window.addEventListener('error', e => {
  const err = e.error || new Error(e.message);
  _logError('SCB-SYS-07', e.message||'Script error', e.filename?e.filename+':'+e.lineno:'', 'globalError', false, err&&err.stack);
  selfHeal('SCB-SYS-07', err, { silent: false });
  console.error('[SCB global error]', err);
});
// -- END SELF-HEALING ---------------------------------------------------------

// -- ERROR LOG ---------------------------------------------------------------
// Persistent session log of every error that passes through scbErr/selfHeal.
// Capped at 300 entries (ring buffer). Survives hot-reloads via sessionStorage.
const _ERR_LOG_KEY = 'scb_error_log';
const _ERR_LOG_MAX = 300;
let _errorLog = (()=>{
  try{ const s=sessionStorage.getItem(_ERR_LOG_KEY); return s?JSON.parse(s):[]; }catch{ return []; }
})();

function _logError(code, message, detail, context, healed, stack){
  const entry={
    ts: Date.now(),
    code: code||'',
    message: String(message||'').slice(0,300),
    detail: detail?String(detail).slice(0,200):undefined,
    context: context||undefined,
    healed: !!healed,
    stack: stack?String(stack).slice(0,600):undefined
  };
  _errorLog.push(entry);
  if(_errorLog.length>_ERR_LOG_MAX) _errorLog.splice(0, _errorLog.length-_ERR_LOG_MAX);
  try{ sessionStorage.setItem(_ERR_LOG_KEY, JSON.stringify(_errorLog)); }catch{}
  _updateErrBadge();
  // Write to Firebase errors/ path — all users write their errors so admin
  // can see cross-session issues in the Error Log tab.
  // Fire-and-forget; never blocks the caller; skips if not signed in yet.
  if(typeof fbdb!=='undefined' && typeof me!=='undefined' && me && me.number){
    const fbEntry={...entry}; delete fbEntry.stack;
    fbEntry.user=me.number;
    try{ fbdb.ref('errors').push(fbEntry).catch(()=>{}); }catch{}
  }
}
function _clearErrorLog(){
  _errorLog=[];
  try{ sessionStorage.removeItem(_ERR_LOG_KEY); }catch{}
  _updateErrBadge();
}
function _updateErrBadge(){
  const count=_errorLog.length;
  const tab=document.getElementById('admin-err-tab');
  if(tab){ tab.textContent=count>0?'⚠️ Errors ('+count+')':'⚠️ Errors'; tab.style.color=count>0?'var(--danger,#e74c3c)':''; }
  const badge=document.getElementById('admin-err-badge');
  if(badge){ badge.hidden=count===0; badge.textContent=count>99?'99+':String(count); }
}
function _buildErrorReport(){
  const lines=['SCB Error Report — '+new Date().toISOString(),'Generated by: #'+(me&&me.number||'?'),'','Code\tTime\tContext\tMessage\tDetail\tHealed'];
  _errorLog.forEach(e=>{
    const t=new Date(e.ts).toISOString().replace('T',' ').slice(0,19);
    lines.push([e.code||'—',t,e.context||'—',(e.message||'').replace(/\t/g,' '),(e.detail||'').replace(/\t/g,' '),e.healed?'YES':'NO'].join('\t'));
  });
  return lines.join('\n');
}
async function renderAdminErrorsTab(){
  const body=document.getElementById('admin-dashboard-body');
  if(!body) return;
  // Merge local log with Firebase remote errors (if admin)
  let remoteErrors=[];
  if(me&&me.number===ADMIN_NUMBER&&typeof fbdb!=='undefined'){
    try{
      const snap=await fbdb.ref('errors').orderByChild('ts').limitToLast(200).once('value');
      if(snap.exists()){
        snap.forEach(c=>{ if(c.val()) remoteErrors.push(c.val()); });
      }
    }catch{}
  }
  // Merge and deduplicate by ts+code
  const seen=new Set(_errorLog.map(e=>e.ts+'|'+e.code));
  const merged=[..._errorLog,...remoteErrors.filter(e=>!seen.has(e.ts+'|'+e.code))];
  merged.sort((a,b)=>b.ts-a.ts);

  const unhealed=merged.filter(e=>!e.healed);
  const summary=`<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
    <div style="background:var(--surface2);border-radius:8px;padding:10px 16px;flex:1;min-width:100px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:var(--text)">${merged.length}</div>
      <div style="font-size:11px;color:var(--muted)">Total Errors</div>
    </div>
    <div style="background:var(--surface2);border-radius:8px;padding:10px 16px;flex:1;min-width:100px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:${unhealed.length?'var(--danger,#e74c3c)':'var(--success)'}">${unhealed.length}</div>
      <div style="font-size:11px;color:var(--muted)">Unrecovered</div>
    </div>
    <div style="background:var(--surface2);border-radius:8px;padding:10px 16px;flex:1;min-width:100px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:var(--text)">${remoteErrors.length}</div>
      <div style="font-size:11px;color:var(--muted)">Remote (Firebase)</div>
    </div>
  </div>`;

  let filterState='all';
  const render=()=>{
    const list=filterState==='unhealed'?merged.filter(e=>!e.healed):
                filterState==='sys'?merged.filter(e=>e.code.startsWith('SCB-SYS')):
                merged;
    if(!list.length) return '<div style="padding:20px;text-align:center;color:var(--muted)">No errors recorded'+(filterState!=='all'?' for this filter':'')+'.</div>';
    return list.map(e=>{
      const t=new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const day=new Date(e.ts).toLocaleDateString([],{month:'short',day:'numeric'});
      const info=SCB_ERROR_CODES[e.code]||null;
      return `<div style="border-bottom:1px solid var(--border);padding:9px 2px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <code style="font-size:11px;background:var(--surface2);padding:2px 6px;border-radius:4px;color:var(--accent)">${esc(e.code||'?')}</code>
          <span style="font-size:11px;color:var(--muted)">${esc(day+' '+t)}</span>
          ${e.context?`<span style="font-size:11px;color:var(--muted);font-style:italic">${esc(e.context)}</span>`:''}
          <span style="margin-left:auto;font-size:10px;padding:2px 7px;border-radius:10px;background:${e.healed?'var(--success,#27ae60)':'var(--danger,#e74c3c)'};color:#fff">${e.healed?'Healed':'Unrecovered'}</span>
        </div>
        <div style="font-size:13px;margin-top:4px;color:var(--text)">${esc(e.message||'')}</div>
        ${e.detail?`<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(e.detail)}</div>`:''}
        ${info?`<div style="font-size:11px;color:var(--text2);margin-top:2px;font-style:italic">${esc(info.meaning)}</div>`:''}
      </div>`;
    }).join('');
  };

  body.innerHTML=`<div style="padding:12px">
    ${summary}
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button onclick="document.querySelectorAll('.efilter').forEach(b=>b.classList.remove('active'));this.classList.add('active');errFilterChange('all')" class="btn btn-sm btn-ghost efilter active">All</button>
      <button onclick="document.querySelectorAll('.efilter').forEach(b=>b.classList.remove('active'));this.classList.add('active');errFilterChange('unhealed')" class="btn btn-sm btn-ghost efilter">Unrecovered</button>
      <button onclick="document.querySelectorAll('.efilter').forEach(b=>b.classList.remove('active'));this.classList.add('active');errFilterChange('sys')" class="btn btn-sm btn-ghost efilter">System</button>
      <button onclick="navigator.clipboard.writeText(_buildErrorReport()).then(()=>showToast('Copied','Error report copied to clipboard.'))" class="btn btn-sm" style="margin-left:auto">📋 Copy Report</button>
      <button onclick="if(confirm('Clear the local error log?')){_clearErrorLog();renderAdminErrorsTab();}" class="btn btn-sm btn-ghost" style="color:var(--danger,#e74c3c)">🗑 Clear</button>
    </div>
    <div class="err-log-wrap" id="err-log-list" style="max-height:360px;overflow-y:auto;font-family:var(--font-mono,monospace)">${render()}</div>
  </div>`;
  window.errFilterChange=(f)=>{
    filterState=f;
    const wrap=body.querySelector('.err-log-wrap');
    if(wrap) wrap.innerHTML=render();
  };
}
// -- END ERROR LOG -----------------------------------------------------------

