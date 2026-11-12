# Instructions

Hi. I want to create a webapplication that hosts a webpage, where I can insert youtube or soundcloud links (multiple, could be of both kinds, one per line), and when I click a load process button, creates a table or form out of each link, gets the youtube video's name into an editable field for filename. After edit I want to click a button that will download an mp3 file in highest possible quality from each link with the previously edited video or song title as the filename. I don't want to be prompted for each file download, I'd rather it downloads automatically to a folder that can be browsed at the top of the UI.
I will paste an example xpath for the video title for a corresponding youtube link:
https://www.youtube.com/watch?v=uCPUhZtgkE8
/html/body/ytd-app/div[1]/ytd-page-manager/ytd-watch-flexy/div[4]/div[1]/div/div[2]/div[5]/ytd-watch-metadata/div/div[1]/div/h1/yt-formatted-string
For soundcloud:
/html/body/div[3]/main/div[1]/section[1]/div/div/div[1]/div[1]/div/div[1]/h1
https://soundcloud.com/kamafaka/breathing-again

