#!/bin/awk -f
FNR == 1 {
	serverReport = 0
	firstPeriod = ""
	hasFilename = 0
}

$3 == "Server" && $4 == "Report:" {
	serverReport = 1
}

serverReport == 1 || $1 != "[" {
	next
}

$2 == "ID]" && $7 == "Lost/Total" {
	heading = $0
}

$3 !~ "^0\\.00-" || $3 ~ "-0\\.00$" || $4 != "sec" || $12 !~ "%" {
	next
}

firstPeriod == "" && $2 ~ "^\\*?1\\]$" {
	firstPeriod = $3
}

firstPeriod != "" && $3 != firstPeriod {
	if (heading != lastHeading) {
		print ""
		print "\033[32m" heading "\033[0m"
		lastHeading = heading
	}
	if (hasFilename == 0) {
		print "\033[33m" "# " FILENAME "\033[0m"
		hasFilename = 1
	}
	print
}

