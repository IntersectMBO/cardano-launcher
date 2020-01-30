all:					\
	launch.png			\
	update-system-old.png		\
	update-system-byron.html	\
	windows-clean-shutdown.html     \
	$(EMPTY)

%.png: %.msc
	mscgen -T png -i $< -o $@

%.html: %.md
	pandoc -f markdown -t html --standalone -o $@ $<

EMPTY :=
