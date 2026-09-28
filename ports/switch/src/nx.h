/* Capa fina sobre libnx (mandos y giroscopio). Va aparte porque <switch.h> define su propio tipo
 * Event, que choca con el de la simulación. Solo se compila en la Switch. */
#ifndef HT_NX_H
#define HT_NX_H

enum { NX_A = 1, NX_B = 2, NX_X = 4, NX_Y = 8, NX_PLUS = 16, NX_MINUS = 32, NX_LEFT = 64, NX_RIGHT = 128,
       NX_CALIB = 256 /* R, ZR o clic de la palanca derecha */ };

typedef struct {
  unsigned down, held;     /* botones recién pulsados / mantenidos (NX_*) */
  double stickX;           /* palanca izquierda, −1..1 */
  int hasAccel;            /* hay lectura del acelerómetro */
  double ax, ay, az;       /* acelerómetro, en g */
} NxPad;

void nx_init(void);        /* sockets + nxlink (printf por red) */
void nx_input_init(void);
void nx_poll(NxPad *p);
int  nx_mainloop(void);
void nx_exit(void);

#endif
