#ifndef NRF_LINK_H
#define NRF_LINK_H

/**
 * @file nrf_link.h
 * @brief Framed binary data link to the nRF52840 over USART1 + DMA.
 *
 * Frame: AA 55 | ver | type | seq | len(LE16) | payload | crc16(LE16)
 * CRC-16/CCITT over ver..payload. Max payload 1008 B (UARTE DMA limit 1023).
 *
 * The nRF should run UARTE at 1 Mbaud with HWFC enabled and re-arm a large
 * RXD buffer on ENDRX (see docs/sensor-data-acquisition.md).
 */

#include "stm32g4xx_hal.h"
#include "sensor_stream.h"
#include <stdint.h>

#define NRF_FRAME_TYPE_PPG_RAW   0x01u
#define NRF_FRAME_TYPE_IMU_RAW   0x02u
#define NRF_FRAME_TYPE_STATUS    0x03u
#define NRF_FRAME_TYPE_TEXT      0x04u
#define NRF_FRAME_TYPE_ECG_RAW   0x05u

#define NRF_MAX_PPG_SAMPLES      64u
#define NRF_MAX_IMU_RECORDS      36u
#define NRF_MAX_ECG_SAMPLES      504u

void Nrf_Init(UART_HandleTypeDef *huart);
void Nrf_Poll(void);

/* Queue a frame; returns 0 if it did not fit in the TX ring. */
uint8_t Nrf_SendFrame(uint8_t type, const uint8_t *payload, uint16_t len);
uint8_t Nrf_SendPPG(const ppg_sample_t *samples, uint16_t n);
uint8_t Nrf_SendIMU(const mpu6886_raw_t *records, uint16_t n);
uint8_t Nrf_SendECG(const uint16_t *samples, uint16_t n);
uint8_t Nrf_SendText(const char *text);

uint32_t Nrf_TxDropped(void);
uint32_t Nrf_RxEvents(void);

#endif /* NRF_LINK_H */
