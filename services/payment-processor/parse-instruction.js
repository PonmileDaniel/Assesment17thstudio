const validator = require('@app-core/validator');
const { throwAppError } = require('@app-core/errors');
const { appLogger } = require('@app-core/logger');
const PaymentMessages = require('@app/messages/payment');

// Step 1: Define your validation spec
const spec = `root {
  accounts[] {
    id string
    balance number
    currency string
  }
  instruction string
}`;

// Step 2: Parse the spec once (outside the function)
const parsedSpec = validator.parse(spec);

const supportedCurrencies = ['NGN', 'USD', 'GBP', 'GHS'];

// Helper functions defined first to avoid hoisting issues
function parseAmount(str) {
  const amount = parseInt(str, 10);
  if (!str || Number.isNaN(amount) || amount <= 0 || str.includes('.')) {
    throwAppError(PaymentMessages.INVALID_AMOUNT, 'AM01');
  }
  return amount;
}

function parseCurrency(str) {
  if (!str || !supportedCurrencies.includes(str.toUpperCase())) {
    throwAppError(PaymentMessages.UNSUPPORTED_CURRENCY, 'CU02');
  }
  return str.toUpperCase();
}

function parseDate(str) {
  if (!str || str.length !== 10 || str[4] !== '-' || str[7] !== '-') {
    throwAppError(PaymentMessages.INVALID_DATE_FORMAT, 'DT01');
  }

  // More thorough date validation without regex
  const year = parseInt(str.substring(0, 4), 10);
  const month = parseInt(str.substring(5, 7), 10);
  const day = parseInt(str.substring(8, 10), 10);

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    throwAppError(PaymentMessages.INVALID_DATE_FORMAT, 'DT01');
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throwAppError(PaymentMessages.INVALID_DATE_FORMAT, 'DT01');
  }

  return str;
}

function parseAccountId(id) {
  if (!id) {
    throwAppError(PaymentMessages.INVALID_ACCOUNT_ID, 'AC04');
  }

  const allowedChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@.-';

  for (let i = 0; i < id.length; i += 1) {
    if (!allowedChars.includes(id[i])) {
      throwAppError(PaymentMessages.INVALID_ACCOUNT_ID, 'AC04');
    }
  }

  return id;
}

function parseDebit(tokens) {
  if (tokens.length < 11) throwAppError(PaymentMessages.MISSING_KEYWORD, 'SY01');

  const amount = parseAmount(tokens[1]);
  const currency = parseCurrency(tokens[2]);

  if (tokens[3].toUpperCase() !== 'FROM' || tokens[4].toUpperCase() !== 'ACCOUNT') {
    throwAppError(PaymentMessages.INVALID_KEYWORD_ORDER, 'SY02');
  }

  const debitAccountId = parseAccountId(tokens[5]);

  if (
    tokens[6].toUpperCase() !== 'FOR' ||
    tokens[7].toUpperCase() !== 'CREDIT' ||
    tokens[8].toUpperCase() !== 'TO' ||
    tokens[9].toUpperCase() !== 'ACCOUNT'
  ) {
    throwAppError(PaymentMessages.INVALID_KEYWORD_ORDER, 'SY02');
  }

  const creditAccountId = parseAccountId(tokens[10]);

  let executeBy = null;
  if (tokens[11] && tokens[11].toUpperCase() === 'ON') {
    executeBy = parseDate(tokens[12]);
  }
  return { amount, currency, debitAccountId, creditAccountId, executeBy };
}

function parseCredit(tokens) {
  if (tokens.length < 11) throwAppError(PaymentMessages.MISSING_KEYWORD, 'SY01');

  const amount = parseAmount(tokens[1]);
  const currency = parseCurrency(tokens[2]);

  if (tokens[3].toUpperCase() !== 'TO' || tokens[4].toUpperCase() !== 'ACCOUNT') {
    throwAppError(PaymentMessages.INVALID_KEYWORD_ORDER, 'SY02');
  }

  const creditAccountId = parseAccountId(tokens[5]);

  if (
    tokens[6].toUpperCase() !== 'FOR' ||
    tokens[7].toUpperCase() !== 'DEBIT' ||
    tokens[8].toUpperCase() !== 'FROM' ||
    tokens[9].toUpperCase() !== 'ACCOUNT'
  ) {
    throwAppError(PaymentMessages.INVALID_KEYWORD_ORDER, 'SY02');
  }

  const debitAccountId = parseAccountId(tokens[10]);

  let executeBy = null;
  if (tokens[11] && tokens[11].toUpperCase() === 'ON') {
    executeBy = parseDate(tokens[12]);
  }
  return { amount, currency, debitAccountId, creditAccountId, executeBy };
}

// Step 3: Define your service function
async function parseInstruction(serviceData) {
  let response;

  // Step 4: Validate input data
  const data = validator.validate(serviceData, parsedSpec);

  try {
    // Step 5: Implement your business logic
    const instruction = data.instruction.trim();
    const { accounts } = data;

    appLogger.info({ instruction }, 'parsing-start');

    const tokens = instruction.split(' ').filter((t) => t.length > 0);

    if (tokens.length < 8) {
      throwAppError(PaymentMessages.MISSING_KEYWORD, 'SY01');
    }

    const firstToken = tokens[0].toUpperCase();
    let amount;
    let currency;
    let debitAccountId;
    let creditAccountId;
    let executeBy = null;

    if (firstToken === 'DEBIT') {
      ({ amount, currency, debitAccountId, creditAccountId, executeBy } = parseDebit(tokens));
    } else if (firstToken === 'CREDIT') {
      ({ amount, currency, debitAccountId, creditAccountId, executeBy } = parseCredit(tokens));
    } else {
      throwAppError(PaymentMessages.MISSING_KEYWORD, 'SY01');
    }

    const debitAccount = accounts.find((a) => a.id === debitAccountId);
    const creditAccount = accounts.find((a) => a.id === creditAccountId);

    if (!debitAccount) {
      throwAppError(PaymentMessages.ACCOUNT_NOT_FOUND, 'AC03');
    }
    if (!creditAccount) {
      throwAppError(PaymentMessages.ACCOUNT_NOT_FOUND, 'AC03');
    }

    if (debitAccount.id === creditAccount.id) {
      throwAppError(PaymentMessages.SAME_ACCOUNT_ERROR, 'AC02');
    }

    if (
      debitAccount.currency.toUpperCase() !== currency ||
      creditAccount.currency.toUpperCase() !== currency
    ) {
      throwAppError(PaymentMessages.CURRENCY_MISMATCH, 'CU01');
    }

    if (debitAccount.balance < amount) {
      throwAppError(PaymentMessages.INSUFFICIENT_FUNDS, 'AC01');
    }

    let status;
    let statusReason;
    let statusCode;

    const now = new Date();
    const executeDate = executeBy ? new Date(`${executeBy}T00:00:00.000Z`) : now;

    const responseAccounts = [];

    accounts.forEach((account) => {
      if (account.id === debitAccountId || account.id === creditAccountId) {
        const accountCopy = {
          id: account.id,
          balance: account.balance,
          balance_before: account.balance,
          currency: account.currency.toUpperCase(),
        };
        responseAccounts.push(accountCopy);
      }
    });

    if (executeDate > now) {
      status = 'pending';
      statusReason = PaymentMessages.TRANSACTION_PENDING;
      statusCode = 'AP02';
    } else {
      responseAccounts.forEach((acc) => {
        if (acc.id === debitAccountId) {
          acc.balance = acc.balance_before - amount;
        } else if (acc.id === creditAccountId) {
          acc.balance = acc.balance_before + amount;
        }
      });

      status = 'successful';
      statusReason = PaymentMessages.TRANSACTION_SUCCESSFUL;
      statusCode = 'AP00';
    }

    response = {
      type: firstToken,
      amount,
      currency,
      debit_account: debitAccountId,
      credit_account: creditAccountId,
      execute_by: executeBy,
      status,
      status_reason: statusReason,
      status_code: statusCode,
      accounts: responseAccounts,
    };

    appLogger.info({ parsed: response }, 'parsing-complete');
  } catch (error) {
    appLogger.error({ error }, 'parse-instruction-error');

    // Handle throwAppError with custom format
    if (error.code && error.message) {
      return {
        type: null,
        amount: null,
        currency: null,
        debit_account: null,
        credit_account: null,
        execute_by: null,
        status: 'failed',
        status_reason: error.message,
        status_code: error.code,
        accounts: [],
      };
    }

    // For any other errors
    return {
      type: null,
      amount: null,
      currency: null,
      debit_account: null,
      credit_account: null,
      execute_by: null,
      status: 'failed',
      status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
      status_code: 'SY03',
      accounts: [],
    };
  }
  // Step 6: Single exit point - return response
  return response;
}

// Step 7: Export the function
module.exports = parseInstruction;
