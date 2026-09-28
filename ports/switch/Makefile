#---------------------------------------------------------------------------------
# Hipertúnel para Nintendo Switch (homebrew): plantilla estándar de libnx.
#   make            -> build/hipertunel.nro
#   make send       -> nxlink -s build/hipertunel.nro (Homebrew Menu en modo netloader: pulsa Y)
# Con devkitPro instalado (DEVKITPRO=/opt/devkitpro). Sin instalarlo, con Docker:
#   docker run --rm -v "$PWD/../..":/p -w /p/ports/switch devkitpro/devkita64 make
#---------------------------------------------------------------------------------
.SUFFIXES:

ifeq ($(strip $(DEVKITPRO)),)
$(error "Falta DEVKITPRO. export DEVKITPRO=/opt/devkitpro")
endif

TOPDIR ?= $(CURDIR)
include $(DEVKITPRO)/libnx/switch_rules

TARGET      := hipertunel
BUILD       := build-nx
SOURCES     := src sim
DATA        :=
INCLUDES    := src sim
APP_TITLE   := Hipertúnel
APP_AUTHOR  := eyrawolf
APP_VERSION := 0.40
ICON        := icon.jpg

#---------------------------------------------------------------------------------
# -ffp-contract=off: sin FMA, para que la simulación redondee igual que JS (ver README)
ARCH     := -march=armv8-a+crc+crypto -mtune=cortex-a57 -mtp=soft -fPIE
CFLAGS   := -g -Wall -O2 -ffunction-sections -ffp-contract=off -std=gnu11 $(ARCH) $(DEFINES)
CFLAGS   += $(INCLUDE) -D__SWITCH__ $(shell $(PORTLIBS)/bin/sdl2-config --cflags)
CXXFLAGS := $(CFLAGS) -fno-rtti -fno-exceptions
ASFLAGS  := -g $(ARCH)
LDFLAGS   = -specs=$(DEVKITPRO)/libnx/switch.specs -g $(ARCH) -Wl,-Map,$(notdir $*.map)
LIBS     := $(shell $(PORTLIBS)/bin/sdl2-config --libs) -lm
LIBDIRS  := $(PORTLIBS) $(LIBNX)

#---------------------------------------------------------------------------------
ifneq ($(BUILD),$(notdir $(CURDIR)))
#---------------------------------------------------------------------------------

export OUTPUT  := $(CURDIR)/build/$(TARGET)
export TOPDIR  := $(CURDIR)
export VPATH   := $(foreach dir,$(SOURCES),$(CURDIR)/$(dir)) $(foreach dir,$(DATA),$(CURDIR)/$(dir))
export DEPSDIR := $(CURDIR)/$(BUILD)

CFILES   := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))
export LD := $(CC)
export OFILES_SRC := $(CFILES:.c=.o)
export OFILES     := $(OFILES_SRC)
export INCLUDE    := $(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) $(foreach dir,$(LIBDIRS),-I$(dir)/include) -I$(CURDIR)/$(BUILD)
export LIBPATHS   := $(foreach dir,$(LIBDIRS),-L$(dir)/lib)
export APP_ICON   := $(TOPDIR)/$(ICON)
export NROFLAGS   += --icon=$(APP_ICON) --nacp=$(OUTPUT).nacp

.PHONY: $(BUILD) clean all send

all: $(BUILD)

$(BUILD):
	@[ -d $@ ] || mkdir -p $@
	@[ -d build ] || mkdir -p build
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile

send: all
	nxlink -s $(OUTPUT).nro

clean:
	@echo limpiando ...
	@rm -fr $(BUILD) $(OUTPUT).nro $(OUTPUT).nacp $(OUTPUT).elf

#---------------------------------------------------------------------------------
else
.PHONY: all

DEPENDS := $(OFILES:.o=.d)

all: $(OUTPUT).nro

$(OUTPUT).nro: $(OUTPUT).elf $(OUTPUT).nacp
$(OUTPUT).elf: $(OFILES)

-include $(DEPENDS)

#---------------------------------------------------------------------------------
endif
