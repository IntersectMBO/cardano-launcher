files := 				\
	example.js			\
	launch.png			\
	update-system-old.png		\
	component-diagram.png		\
	component-diagram.svg		\
	update-system-byron.html	\
	windows-clean-shutdown.html     \
	$(EMPTY)

installdir := ../$(shell jq -r .typedocOptions.out ../tsconfig.json)

install: $(files)
	test -z "$(installdir)" || install -m644 -D -t "$(installdir)" $^

%.png: %.msc
	mscgen -T png -i $< -o $@

%.png: %.svg
	rsvg-convert -o $@ $<

%.html: %.md
	pandoc -f markdown -t html --standalone -o $@ $<

EMPTY :=

.PHONY: install
