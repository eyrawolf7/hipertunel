#ifndef HT_PNG_H
#define HT_PNG_H
/* Guarda RGBA de 8 bits como PNG RGB. flipY = 1 para lo que sale de glReadPixels. */
int png_write(const char *path, const unsigned char *rgba, int w, int h, int flipY);
#endif
