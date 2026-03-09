import { todayYmdLocal } from '../aena/aena.js';
import { config } from '../config.js';
import {
  getMaxAenaSyncTs,
  deleteNotMatchedAfterSync,
  deleteOlderThan
} from '../repositories/shuttleFlightsRepo.js';
import { sendMail } from '../mailer.js';

let VERIFY_RUNNING = false;

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// "Verify" is now a cleanup/maintenance task.
// - Deletes AENA-sourced rows that were NOT seen in the latest sync ("not matched")
// - Deletes rows older than MAX_DAYS_PAST
export async function runAenaVerify({ logger }) {
  if (VERIFY_RUNNING) {
    logger.warn('AENA verify already running');
    return { ok: false, error: 'AENA_VERIFY_ALREADY_RUNNING' };
  }

  VERIFY_RUNNING = true;

  try {
    const startedAt = new Date();
    const nowIso = startedAt.toISOString();

    const today = todayYmdLocal();
    const startYmd = addDaysYmd(today, -Math.abs(config.MAX_DAYS_PAST));
    const endYmd = addDaysYmd(today, Math.abs(config.MAX_DAYS_AHEAD));

    // Infer the latest AENA sync timestamp from the data itself.
    const syncTs = await getMaxAenaSyncTs({ startYmd, endYmd });

    // 1) Delete "not matched" from the latest sync window (only AENA-sourced rows)
    const deletedNotMatched = await deleteNotMatchedAfterSync({ startYmd, endYmd, syncTs });

    // 2) Delete older than cutoff
    const cutoffYmd = addDaysYmd(today, -Math.abs(config.MAX_DAYS_PAST));
    const deletedOld = await deleteOlderThan({ cutoffYmd });

    const deleted = deletedNotMatched + deletedOld;

    await sendMail(
      'AENA verificación finalizada',
      `AENA verificación finalizada\nFecha: ${nowIso}\nRango: ${startYmd}..${endYmd}\nDeleted: ${deleted}\n- Not matched (latest sync): ${deletedNotMatched}\n- Too old (< ${cutoffYmd}): ${deletedOld}`,
      logger
    );

    return {
      ok: true,
      now: nowIso,
      range: { startYmd, endYmd },
      deleted,
      deletedNotMatched,
      deletedOld,
      syncTs
    };
  } finally {
    VERIFY_RUNNING = false;
  }
}
