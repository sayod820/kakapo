'use strict'

/**
 * Раньше здесь rcedit ставил иконку ПОСЛЕ asar-integrity —
 * из‑за этого касса на части ПК не запускалась (ошибка про версию/целостность).
 * Иконка берётся из build.win.icon; afterPack больше exe не трогает.
 */
exports.default = async function afterPack() {
  /* no-op: не патчим exe после integrity */
}
