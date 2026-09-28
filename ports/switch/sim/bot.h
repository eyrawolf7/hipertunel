/* Piloto automático: port exacto de app/src/sim/bot.js (demo del título y pruebas). */
#ifndef HT_BOT_H
#define HT_BOT_H

#include "game.h"

double bot_steer(const Game *g, int look);   /* look = 14 en JS por defecto */

#endif
