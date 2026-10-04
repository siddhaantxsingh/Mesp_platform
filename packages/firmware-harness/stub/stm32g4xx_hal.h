/* Host stub of the HAL surface used by nrf_link.c (conformance harness only). */
#ifndef STM32G4XX_HAL_H
#define STM32G4XX_HAL_H
#include <stdint.h>
#include <stddef.h>
typedef enum { HAL_OK = 0, HAL_ERROR, HAL_BUSY, HAL_TIMEOUT } HAL_StatusTypeDef;
typedef struct { int dummy; } USART_TypeDef;
typedef struct { USART_TypeDef *Instance; } UART_HandleTypeDef;
typedef int IRQn_Type;
#define USART1_IRQn 37
void HAL_NVIC_SetPriority(IRQn_Type irq, uint32_t p, uint32_t s);
void HAL_NVIC_EnableIRQ(IRQn_Type irq);
HAL_StatusTypeDef HAL_UART_Transmit_DMA(UART_HandleTypeDef *h, const uint8_t *d, uint16_t n);
HAL_StatusTypeDef HAL_UARTEx_ReceiveToIdle_DMA(UART_HandleTypeDef *h, uint8_t *d, uint16_t n);
#endif
