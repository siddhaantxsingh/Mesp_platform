/*
 * Conformance harness: links the firmware's own nrf_link.c (vendored verbatim)
 * against a host HAL stub, captures the exact bytes it would DMA to USART1,
 * and prints them as JSON golden vectors. The platform's Python and TypeScript
 * decoders are tested against these bytes, so the protocol is not assumed.
 */
#include <stdio.h>
#include <string.h>
#include "nrf_link.h"

static UART_HandleTypeDef huart; static USART_TypeDef inst;
static uint8_t cap[65536]; static size_t cap_len;
void HAL_NVIC_SetPriority(IRQn_Type i, uint32_t p, uint32_t s) { (void)i; (void)p; (void)s; }
void HAL_NVIC_EnableIRQ(IRQn_Type i) { (void)i; }
HAL_StatusTypeDef HAL_UARTEx_ReceiveToIdle_DMA(UART_HandleTypeDef *h, uint8_t *d, uint16_t n) { (void)h; (void)d; (void)n; return HAL_OK; }
void HAL_UART_TxCpltCallback(UART_HandleTypeDef *huart);
static int tx_pending;
HAL_StatusTypeDef HAL_UART_Transmit_DMA(UART_HandleTypeDef *h, const uint8_t *d, uint16_t n) {
    (void)h; memcpy(cap + cap_len, d, n); cap_len += n; tx_pending = 1;
    return HAL_OK;
}
/* Complete every queued "DMA" transfer, as the TC interrupt would (handles ring wrap). */
static void flush(void) { while (tx_pending) { tx_pending = 0; HAL_UART_TxCpltCallback(&huart); } }
void Console_OnTxCplt(UART_HandleTypeDef *h) { (void)h; }

static void emit(const char *name, const char *desc, int last) {
    flush();
    printf("  {\"name\": \"%s\", \"description\": \"%s\", \"hex\": \"", name, desc);
    for (size_t i = 0; i < cap_len; i++) printf("%02x", cap[i]);
    printf("\"}%s\n", last ? "" : ",");
    cap_len = 0;
}

int main(void) {
    huart.Instance = &inst;
    Nrf_Init(&huart);
    printf("{\"source\": \"MESP_lab firmware Core/Src/nrf_link.c (vendored verbatim)\", \"vectors\": [\n");

    ppg_sample_t ppg[4] = {{0x3FFFF, 0x00001}, {123456, 234567}, {0, 0x2ABCD}, {100000, 200000}};
    Nrf_SendPPG(ppg, 4);              emit("ppg_4", "PPG_RAW 4 samples, seq 0", 0);

    mpu6886_raw_t imu[2] = {{8192, -8192, 0, -1234, 655, -655, 32767}, {-32768, 1, -1, 0, 0, 1, -2}};
    Nrf_SendIMU(imu, 2);              emit("imu_2", "IMU_RAW 2 records, seq 1", 0);

    uint16_t ecg[6] = {0, 2048, 4095, 1, 0x0ABC, 3000};
    Nrf_SendECG(ecg, 6);              emit("ecg_6", "ECG_RAW 6 samples, seq 2", 0);

    Nrf_SendText("boot: ppg=25sps imu=1kHz"); emit("text_boot", "TEXT boot line as sent by main.c, seq 3", 0);
    Nrf_SendText("stats ppg=25 imu=1000 ecg=1000 ovf=0 drop=0"); emit("text_stats", "TEXT 1 Hz stats line, seq 4", 0);
    Nrf_SendFrame(0x03, (const uint8_t *)"", 0); emit("status_empty", "STATUS with empty payload, seq 5", 0);

    static uint16_t ecg_full[504];
    for (int i = 0; i < 504; i++) ecg_full[i] = (uint16_t)((i * 37) & 0x0FFF);
    Nrf_SendECG(ecg_full, 504);       emit("ecg_max", "ECG_RAW max 504 samples (1008 B payload), seq 6", 0);

    /* sequence wrap: advance the 8-bit counter to 255, then send two frames */
    for (int i = 7; i < 255; i++) { Nrf_SendText("x"); flush(); cap_len = 0; }
    Nrf_SendText("seq255");           emit("seq_255", "TEXT at seq 255", 0);
    Nrf_SendText("seq0");             emit("seq_wrap_0", "TEXT after wrap, seq 0", 1);
    printf("]}\n");
    return 0;
}
