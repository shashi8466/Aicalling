const Imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const logger = require('../logger');
const poller = require('../jobs/emailCallbackPoller');
const cfg = require('../config');

const imapConfig = {
  imap: {
    user: cfg.imap.user,
    password: cfg.imap.password,
    host: cfg.imap.host,
    port: cfg.imap.port,
    tls: cfg.imap.tls,
    authTimeout: 30000,
    tlsOptions: { rejectUnauthorized: false }
  }
};

let connection = null;

async function connect() {
  if (!cfg.imap.password) {
    logger.warn('IMAP password not set. Email IMAP polling is disabled.');
    return;
  }
  try {
    connection = await Imap.connect(imapConfig);
    logger.info('IMAP Connected successfully to ' + imapConfig.imap.user);
    connection.on('mail', () => {
      logger.info('New mail received event triggered.');
      fetchEmails();
    });
    connection.on('error', (err) => {
      logger.error('IMAP Error: ' + err.message);
    });
    connection.on('close', () => {
      logger.warn('IMAP Connection closed. Reconnecting...');
      setTimeout(connect, 10000);
    });
    connection.on('end', () => {
      logger.warn('IMAP Connection ended.');
    });
    
    fetchEmails();
    setInterval(fetchEmails, 60000);
    
  } catch (e) {
    logger.error('IMAP Connection failed: ' + e.message);
    setTimeout(connect, 30000);
  }
}

let isFetching = false;

async function fetchEmails() {
  if (!connection || isFetching) return;
  isFetching = true;
  try {
    await connection.openBox('INBOX');
    const searchCriteria = ['UNSEEN'];
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false
    };
    
    const messages = await connection.search(searchCriteria, fetchOptions);
    if (messages.length === 0) {
      isFetching = false;
      return;
    }
    
    logger.info('Found ' + messages.length + ' unread emails.');
    
    for (const item of messages) {
      const all = item.parts.find(part => part.which === '');
      const id = item.attributes.uid;
      const idHeader = 'Imap-Id: ' + id + '\r\n';
      
      const mail = await simpleParser(idHeader + all.body);
      
      const subject = mail.subject || '';
      const body = mail.text || mail.html || '';
      const fromEmail = mail.from && mail.from.value && mail.from.value[0] ? mail.from.value[0].address : '';
      const fromName = mail.from && mail.from.value && mail.from.value[0] ? mail.from.value[0].name : fromEmail.split('@')[0];
      
      await poller.processEmail(subject, body, fromEmail, fromName, mail);
      
      await connection.addFlags(id, ['\\Seen']);
      logger.info('Processed and marked email UID ' + id + ' as seen.');
    }
    
  } catch (e) {
    logger.error('Error fetching IMAP emails: ' + e.message);
  } finally {
    isFetching = false;
  }
}

module.exports = { connect };
