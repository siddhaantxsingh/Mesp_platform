/* Host stub: only the sample types nrf_link.c serialises (same layout as firmware). */
#ifndef SENSOR_STREAM_H
#define SENSOR_STREAM_H
#include <stdint.h>
typedef struct { uint32_t red; uint32_t ir; } ppg_sample_t;
typedef struct { int16_t ax, ay, az; int16_t temp; int16_t gx, gy, gz; } mpu6886_raw_t;
#endif
