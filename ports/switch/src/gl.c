/* Carga de las funciones de OpenGL (ver glmini.h). */
#define HT_GL_NO_MACROS
#include "glmini.h"
#include <stdio.h>

#define HT_GL_DEF(ret, name, args) PFN_##name ht_##name;
HT_GL_FUNCS(HT_GL_DEF)
#undef HT_GL_DEF

int gl_load(void *(*getproc)(const char *)) {
  int missing = 0;
#define HT_GL_GET(ret, name, args) \
  ht_##name = (PFN_##name)getproc(#name); \
  if (!ht_##name) { fprintf(stderr, "GL: falta %s\n", #name); missing++; }
  HT_GL_FUNCS(HT_GL_GET)
#undef HT_GL_GET
  return missing;
}
