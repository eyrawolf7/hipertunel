/* Sonido sintetizado (ver audio.c). */
#ifndef HT_AUDIO_H
#define HT_AUDIO_H

typedef enum { AU_COIN, AU_BOOST, AU_CRASH, AU_DEATH, AU_NEAR, AU_COUNT, AU_GO, AU_WORLD, AU_RECORD, AU_MENU, AU_MULT, AU_FOLD } AuSound;

void au_init(void);
void au_quit(void);
void au_set(double speed01, int engine, int music);   /* cada fotograma */
void au_play(AuSound s, int arg);
void au_pause(int p);

#endif
