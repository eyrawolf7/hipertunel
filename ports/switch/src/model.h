/* Modelos GLB de la web (los mismos archivos de app/src/assets/, metidos en el ejecutable). */
#ifndef HT_MODEL_H
#define HT_MODEL_H
#include "glmini.h"

#define MODEL_MAXP 8
/* una primitiva = una malla con un material. Vértice: pos3 nrm3 uv2 tan4 col4 (16 floats) */
typedef struct {
  GLuint vao, vbo, ibo; int nIdx;
  char mat[24];                 /* nombre del material en Blender (stone, crystal, rune, Leaf…) */
  float color[4], emissive[3];  /* baseColorFactor y emissiveFactor */
  int blend;                    /* alphaMode BLEND (cascadas) */
  float bmin[3], bmax[3];
} Prim;
typedef struct { char name[32]; Prim p[MODEL_MAXP]; int n; } Model;

/* Carga el GLB `asset` (nombre de assets_data.c). Si `node` no es NULL, solo las mallas de ese
   nodo (y sus hijos); si no, todo el archivo. Aplica las transformaciones de los nodos. */
int  model_load(Model *m, const char *asset, const char *node);
/* enlaza un búfer de instancias a los VAO de todas las primitivas: atributos desde `firstLoc`,
   `nAttr` atributos de los tamaños dados (en floats), divisor 1 */
void model_bind_instances(Model *m, GLuint vbo, int firstLoc, int nAttr, const int *sizes);
#endif
