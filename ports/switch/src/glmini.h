/* Cargador mínimo de OpenGL: tipos, constantes y punteros a las ~50 funciones que usa el juego.
 * Se rellenan con SDL_GL_GetProcAddress, así sirve igual para GL 3.3 core (Mac, PC) y para
 * OpenGL ES 3.0 (mesa de la Switch) sin depender de glad ni de las cabeceras del sistema. */
#ifndef HT_GLMINI_H
#define HT_GLMINI_H

#include <stddef.h>
#include <stdint.h>

typedef unsigned int GLenum;
typedef unsigned int GLuint;
typedef int GLint;
typedef int GLsizei;
typedef float GLfloat;
typedef unsigned char GLboolean;
typedef char GLchar;
typedef unsigned int GLbitfield;
typedef unsigned char GLubyte;
typedef ptrdiff_t GLsizeiptr;
typedef ptrdiff_t GLintptr;

#define GL_FALSE 0
#define GL_TRUE 1
#define GL_DEPTH_BUFFER_BIT 0x00000100
#define GL_COLOR_BUFFER_BIT 0x00004000
#define GL_TRIANGLES 0x0004
#define GL_LINES 0x0001
#define GL_TRIANGLE_STRIP 0x0005
#define GL_LEQUAL 0x0203
#define GL_LESS 0x0201
#define GL_SRC_ALPHA 0x0302
#define GL_ONE_MINUS_SRC_ALPHA 0x0303
#define GL_ONE 1
#define GL_FRONT 0x0404
#define GL_BACK 0x0405
#define GL_CULL_FACE 0x0B44
#define GL_DEPTH_TEST 0x0B71
#define GL_BLEND 0x0BE2
#define GL_POLYGON_OFFSET_FILL 0x8037
#define GL_UNSIGNED_BYTE 0x1401
#define GL_UNSIGNED_SHORT 0x1403
#define GL_UNSIGNED_INT 0x1405
#define GL_FLOAT 0x1406
#define GL_RGBA 0x1908
#define GL_RGBA8 0x8058
/* texturas */
#define GL_TEXTURE_2D 0x0DE1
#define GL_TEXTURE0 0x84C0
#define GL_TEXTURE_MIN_FILTER 0x2801
#define GL_TEXTURE_MAG_FILTER 0x2800
#define GL_TEXTURE_WRAP_S 0x2802
#define GL_TEXTURE_WRAP_T 0x2803
#define GL_LINEAR 0x2601
#define GL_LINEAR_MIPMAP_LINEAR 0x2703
#define GL_REPEAT 0x2901
#define GL_CLAMP_TO_EDGE 0x812F
#define GL_RGB 0x1907
#define GL_RGBA 0x1908
#define GL_RGB8 0x8051
#define GL_SRGB8 0x8C41
#define GL_SRGB8_ALPHA8 0x8C43
#define GL_UNPACK_ALIGNMENT 0x0CF5
#define GL_RGBA16F 0x881A
#define GL_R8 0x8229
#define GL_RED 0x1903
#define GL_HALF_FLOAT 0x140B
#define GL_DRAW_FRAMEBUFFER_BINDING 0x8CA6
#define GL_READ_FRAMEBUFFER_BINDING 0x8CAA
#define GL_VENDOR 0x1F00
#define GL_RENDERER 0x1F01
#define GL_VERSION 0x1F02
#define GL_ARRAY_BUFFER 0x8892
#define GL_ELEMENT_ARRAY_BUFFER 0x8893
#define GL_STATIC_DRAW 0x88E4
#define GL_DYNAMIC_DRAW 0x88E8
#define GL_STREAM_DRAW 0x88E0
#define GL_FRAGMENT_SHADER 0x8B30
#define GL_VERTEX_SHADER 0x8B31
#define GL_COMPILE_STATUS 0x8B81
#define GL_LINK_STATUS 0x8B82
#define GL_INFO_LOG_LENGTH 0x8B84
#define GL_FRAMEBUFFER 0x8D40
#define GL_READ_FRAMEBUFFER 0x8CA8
#define GL_DRAW_FRAMEBUFFER 0x8CA9
#define GL_RENDERBUFFER 0x8D41
#define GL_COLOR_ATTACHMENT0 0x8CE0
#define GL_DEPTH_ATTACHMENT 0x8D00
#define GL_DEPTH_COMPONENT24 0x81A6
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#define GL_PACK_ALIGNMENT 0x0D05
#define GL_NEAREST 0x2600
#define GL_CW 0x0900
#define GL_CCW 0x0901

#define HT_GL_FUNCS(X) \
  X(void, glViewport, (GLint x, GLint y, GLsizei w, GLsizei h)) \
  X(void, glClearColor, (GLfloat r, GLfloat g, GLfloat b, GLfloat a)) \
  X(void, glClear, (GLbitfield m)) \
  X(void, glEnable, (GLenum c)) \
  X(void, glDisable, (GLenum c)) \
  X(void, glBlendFunc, (GLenum s, GLenum d)) \
  X(void, glDepthMask, (GLboolean f)) \
  X(void, glDepthFunc, (GLenum f)) \
  X(void, glCullFace, (GLenum m)) \
  X(void, glFrontFace, (GLenum m)) \
  X(void, glPolygonOffset, (GLfloat f, GLfloat u)) \
  X(GLenum, glGetError, (void)) \
  X(const GLubyte *, glGetString, (GLenum n)) \
  X(void, glPixelStorei, (GLenum p, GLint v)) \
  X(void, glReadPixels, (GLint x, GLint y, GLsizei w, GLsizei h, GLenum f, GLenum t, void *d)) \
  X(GLuint, glCreateShader, (GLenum t)) \
  X(void, glShaderSource, (GLuint s, GLsizei n, const GLchar *const *str, const GLint *len)) \
  X(void, glCompileShader, (GLuint s)) \
  X(void, glGetShaderiv, (GLuint s, GLenum p, GLint *v)) \
  X(void, glGetShaderInfoLog, (GLuint s, GLsizei n, GLsizei *l, GLchar *log)) \
  X(void, glDeleteShader, (GLuint s)) \
  X(GLuint, glCreateProgram, (void)) \
  X(void, glAttachShader, (GLuint p, GLuint s)) \
  X(void, glBindAttribLocation, (GLuint p, GLuint i, const GLchar *n)) \
  X(void, glLinkProgram, (GLuint p)) \
  X(void, glGetProgramiv, (GLuint p, GLenum n, GLint *v)) \
  X(void, glGetProgramInfoLog, (GLuint p, GLsizei n, GLsizei *l, GLchar *log)) \
  X(void, glUseProgram, (GLuint p)) \
  X(GLint, glGetUniformLocation, (GLuint p, const GLchar *n)) \
  X(void, glUniform1f, (GLint l, GLfloat a)) \
  X(void, glUniform2f, (GLint l, GLfloat a, GLfloat b)) \
  X(void, glUniform3f, (GLint l, GLfloat a, GLfloat b, GLfloat c)) \
  X(void, glUniform4f, (GLint l, GLfloat a, GLfloat b, GLfloat c, GLfloat d)) \
  X(void, glUniformMatrix4fv, (GLint l, GLsizei n, GLboolean t, const GLfloat *v)) \
  X(void, glGenBuffers, (GLsizei n, GLuint *b)) \
  X(void, glBindBuffer, (GLenum t, GLuint b)) \
  X(void, glBufferData, (GLenum t, GLsizeiptr n, const void *d, GLenum u)) \
  X(void, glBufferSubData, (GLenum t, GLintptr o, GLsizeiptr n, const void *d)) \
  X(void, glGenVertexArrays, (GLsizei n, GLuint *a)) \
  X(void, glBindVertexArray, (GLuint a)) \
  X(void, glEnableVertexAttribArray, (GLuint i)) \
  X(void, glVertexAttribPointer, (GLuint i, GLint n, GLenum t, GLboolean norm, GLsizei st, const void *p)) \
  X(void, glDrawArrays, (GLenum m, GLint f, GLsizei n)) \
  X(void, glDrawElements, (GLenum m, GLsizei n, GLenum t, const void *i)) \
  X(void, glGenFramebuffers, (GLsizei n, GLuint *f)) \
  X(void, glBindFramebuffer, (GLenum t, GLuint f)) \
  X(void, glGenRenderbuffers, (GLsizei n, GLuint *r)) \
  X(void, glBindRenderbuffer, (GLenum t, GLuint r)) \
  X(void, glRenderbufferStorage, (GLenum t, GLenum f, GLsizei w, GLsizei h)) \
  X(void, glRenderbufferStorageMultisample, (GLenum t, GLsizei s, GLenum f, GLsizei w, GLsizei h)) \
  X(void, glFramebufferRenderbuffer, (GLenum t, GLenum a, GLenum rt, GLuint r)) \
  X(GLenum, glCheckFramebufferStatus, (GLenum t)) \
  X(void, glGenTextures, (GLsizei n, GLuint *t)) \
  X(void, glBindTexture, (GLenum t, GLuint x)) \
  X(void, glActiveTexture, (GLenum u)) \
  X(void, glTexImage2D, (GLenum t, GLint l, GLint inf, GLsizei w, GLsizei h, GLint b, GLenum f, GLenum ty, const void *d)) \
  X(void, glTexParameteri, (GLenum t, GLenum p, GLint v)) \
  X(void, glGenerateMipmap, (GLenum t)) \
  X(void, glUniform1i, (GLint l, GLint v)) \
  X(void, glVertexAttribDivisor, (GLuint i, GLuint d)) \
  X(void, glFramebufferTexture2D, (GLenum t, GLenum a, GLenum tt, GLuint tex, GLint l)) \
  X(void, glGetIntegerv, (GLenum p, GLint *v)) \
  X(void, glDrawElementsInstanced, (GLenum m, GLsizei n, GLenum t, const void *i, GLsizei c)) \
  X(void, glBlitFramebuffer, (GLint a, GLint b, GLint c, GLint d, GLint e, GLint f, GLint g, GLint h, GLbitfield m, GLenum fl))

/* Los punteros llevan el prefijo ht_ para no chocar con los símbolos de libGLESv2/libGL al enlazar;
   las macros de abajo dejan escribir glViewport(...) como siempre. */
#define HT_GL_DECL(ret, name, args) typedef ret (*PFN_##name) args; extern PFN_##name ht_##name;
HT_GL_FUNCS(HT_GL_DECL)
#undef HT_GL_DECL
#ifndef HT_GL_NO_MACROS
#define glViewport ht_glViewport
#define glGenTextures ht_glGenTextures
#define glBindTexture ht_glBindTexture
#define glActiveTexture ht_glActiveTexture
#define glTexImage2D ht_glTexImage2D
#define glTexParameteri ht_glTexParameteri
#define glGenerateMipmap ht_glGenerateMipmap
#define glUniform1i ht_glUniform1i
#define glVertexAttribDivisor ht_glVertexAttribDivisor
#define glFramebufferTexture2D ht_glFramebufferTexture2D
#define glGetIntegerv ht_glGetIntegerv
#define glDrawElementsInstanced ht_glDrawElementsInstanced
#define glClearColor ht_glClearColor
#define glClear ht_glClear
#define glEnable ht_glEnable
#define glDisable ht_glDisable
#define glBlendFunc ht_glBlendFunc
#define glDepthMask ht_glDepthMask
#define glDepthFunc ht_glDepthFunc
#define glCullFace ht_glCullFace
#define glFrontFace ht_glFrontFace
#define glPolygonOffset ht_glPolygonOffset
#define glGetError ht_glGetError
#define glGetString ht_glGetString
#define glPixelStorei ht_glPixelStorei
#define glReadPixels ht_glReadPixels
#define glCreateShader ht_glCreateShader
#define glShaderSource ht_glShaderSource
#define glCompileShader ht_glCompileShader
#define glGetShaderiv ht_glGetShaderiv
#define glGetShaderInfoLog ht_glGetShaderInfoLog
#define glDeleteShader ht_glDeleteShader
#define glCreateProgram ht_glCreateProgram
#define glAttachShader ht_glAttachShader
#define glBindAttribLocation ht_glBindAttribLocation
#define glLinkProgram ht_glLinkProgram
#define glGetProgramiv ht_glGetProgramiv
#define glGetProgramInfoLog ht_glGetProgramInfoLog
#define glUseProgram ht_glUseProgram
#define glGetUniformLocation ht_glGetUniformLocation
#define glUniform1f ht_glUniform1f
#define glUniform2f ht_glUniform2f
#define glUniform3f ht_glUniform3f
#define glUniform4f ht_glUniform4f
#define glUniformMatrix4fv ht_glUniformMatrix4fv
#define glGenBuffers ht_glGenBuffers
#define glBindBuffer ht_glBindBuffer
#define glBufferData ht_glBufferData
#define glBufferSubData ht_glBufferSubData
#define glGenVertexArrays ht_glGenVertexArrays
#define glBindVertexArray ht_glBindVertexArray
#define glEnableVertexAttribArray ht_glEnableVertexAttribArray
#define glVertexAttribPointer ht_glVertexAttribPointer
#define glDrawArrays ht_glDrawArrays
#define glDrawElements ht_glDrawElements
#define glGenFramebuffers ht_glGenFramebuffers
#define glBindFramebuffer ht_glBindFramebuffer
#define glGenRenderbuffers ht_glGenRenderbuffers
#define glBindRenderbuffer ht_glBindRenderbuffer
#define glRenderbufferStorage ht_glRenderbufferStorage
#define glRenderbufferStorageMultisample ht_glRenderbufferStorageMultisample
#define glFramebufferRenderbuffer ht_glFramebufferRenderbuffer
#define glCheckFramebufferStatus ht_glCheckFramebufferStatus
#define glBlitFramebuffer ht_glBlitFramebuffer
#endif

/* Devuelve 0 si todo cargó; si no, el número de funciones que faltan. */
int gl_load(void *(*getproc)(const char *));

#endif
