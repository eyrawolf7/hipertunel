/* Ver nx.h. */
#ifdef __SWITCH__
#include <switch.h>
#include <string.h>
#include "nx.h"

static PadState pad;
static HidSixAxisSensorHandle hHand, hFull, hDual[2];
static int sock;

void nx_init(void) { sock = R_SUCCEEDED(socketInitializeDefault()); if (sock) nxlinkStdio(); }
void nx_exit(void) { if (sock) socketExit(); }
int nx_mainloop(void) { return appletMainLoop(); }

void nx_input_init(void) {
  padConfigureInput(1, HidNpadStyleSet_NpadStandard);
  padInitializeDefault(&pad);
  hidGetSixAxisSensorHandles(&hHand, 1, HidNpadIdType_Handheld, HidNpadStyleTag_NpadHandheld);
  hidGetSixAxisSensorHandles(&hFull, 1, HidNpadIdType_No1, HidNpadStyleTag_NpadFullKey);
  hidGetSixAxisSensorHandles(hDual, 2, HidNpadIdType_No1, HidNpadStyleTag_NpadJoyDual);
  hidStartSixAxisSensor(hHand); hidStartSixAxisSensor(hFull);
  hidStartSixAxisSensor(hDual[0]); hidStartSixAxisSensor(hDual[1]);
}

static unsigned map(u64 b) {
  unsigned r = 0;
  if (b & HidNpadButton_A) r |= NX_A;
  if (b & HidNpadButton_B) r |= NX_B;
  if (b & HidNpadButton_X) r |= NX_X;
  if (b & HidNpadButton_Y) r |= NX_Y;
  if (b & HidNpadButton_Plus) r |= NX_PLUS;
  if (b & HidNpadButton_Minus) r |= NX_MINUS;
  if (b & HidNpadButton_Left) r |= NX_LEFT;
  if (b & HidNpadButton_Right) r |= NX_RIGHT;
  if (b & (HidNpadButton_R | HidNpadButton_ZR | HidNpadButton_StickR)) r |= NX_CALIB;
  return r;
}

void nx_poll(NxPad *p) {
  HidAnalogStickState ls;
  HidSixAxisSensorState st;
  u32 style;
  size_t got = 0;
  double x;
  padUpdate(&pad);
  p->down = map(padGetButtonsDown(&pad));
  p->held = map(padGetButtons(&pad));
  ls = padGetStickPos(&pad, 0);
  x = ls.x / 32767.0;
  p->stickX = x > 0.12 || x < -0.12 ? (x > 1 ? 1 : x < -1 ? -1 : x) : 0;
  /* el sensor del mando que se esté usando: portátil, mando Pro o los dos Joy-Con */
  style = padGetStyleSet(&pad);
  memset(&st, 0, sizeof st);
  if (style & HidNpadStyleTag_NpadHandheld) got = hidGetSixAxisSensorStates(hHand, &st, 1);
  else if (style & HidNpadStyleTag_NpadFullKey) got = hidGetSixAxisSensorStates(hFull, &st, 1);
  else if (style & HidNpadStyleTag_NpadJoyDual) got = hidGetSixAxisSensorStates(hDual[1], &st, 1);
  p->hasAccel = got > 0;
  p->ax = st.acceleration.x; p->ay = st.acceleration.y; p->az = st.acceleration.z;
}
#endif
