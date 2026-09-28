/* Entrada: port de la lógica de app/src/input/index.js. Todo acaba en la magnitud "a" del
 * original (≈ 0,981·sen(inclinación), con el cero calibrado restado) que espera game_step. */
#ifndef HT_INPUT_H
#define HT_INPUT_H

typedef struct {
  /* lo rellena la plataforma cada fotograma */
  int dl, dr;            /* dirección digital pulsada (teclas, cruceta) */
  double stickX;         /* palanca, −1..1 (ya con zona muerta) */
  int hasTilt;           /* hay giroscopio/acelerómetro */
  double tiltRaw;        /* 0,981·sen(inclinación), sin calibrar */
  /* ajustes */
  int tiltOn, invert;
  double sens, cal;
  /* estado interno de la asistencia de carril */
  double holdT; int dir, hasTarget, target;
  int src;               /* 0 nada, 1 digital, 2 palanca, 3 inclinación */
} Input;

void   input_init(Input *in);
void   input_calibrate(Input *in);
/* Una vez por paso de simulación (60 Hz). theta: ángulo del jugador; open: lámina abierta. */
double input_steer(Input *in, double dt, double theta, int open);

#endif
