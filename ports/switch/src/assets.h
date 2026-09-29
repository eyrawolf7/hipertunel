/* Texturas de la web metidas en el ejecutable (tools/embed.py). */
#ifndef HT_ASSETS_H
#define HT_ASSETS_H
typedef struct { const char *name; const unsigned char *data; unsigned size; } Asset;
extern const Asset ASSETS[];
#endif
